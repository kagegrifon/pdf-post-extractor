import robotoUrl from 'roboto-fontface/fonts/roboto/Roboto-Regular.woff?url';
import { PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractFile } from '../extract';
import { mapWithLimit } from '../pool';
import { DEFAULT_PRESET_ID, getPreset, PRESETS } from '../presets';
import { renderSheet, sheetFileName } from '../render';
import {
  addPending,
  duplicateTracks,
  moveEntry,
  readyShipments,
  removeEntry,
  resolveEntry,
  type FileEntry,
} from '../state';

/** Сколько файлов разбирается одновременно. */
const EXTRACT_CONCURRENCY = 4;

const MARKUP = `
  <header><h1>Отправления: печать фрагментов</h1></header>
  <main>
    <section class="panel">
      <div id="drop" class="drop" tabindex="0" role="button">
        Перетащите PDF-бланки сюда или нажмите, чтобы выбрать
      </div>
      <input id="file-input" type="file" accept="application/pdf,.pdf" multiple hidden />
      <p id="summary"></p>
      <ol id="file-list" class="file-list"></ol>
    </section>
    <section class="panel">
      <label>Раскладка <select id="preset"></select></label>
      <div class="actions">
        <button id="download" disabled>Скачать PDF</button>
        <button id="print" disabled>Печать</button>
      </div>
      <p class="hint">
        <strong>Печатайте в масштабе 100%</strong> (не «по размеру страницы»),
        иначе штрихкод может не считаться.
      </p>
      <p id="sheet-status"></p>
      <iframe id="preview" title="Превью PDF"></iframe>
    </section>
  </main>
  <footer>
    <span id="version"></span>
    <div id="update-banner" hidden>
      Доступна новая версия <button id="update-btn">Обновить</button>
    </div>
  </footer>
`;

export function mountApp(root: HTMLElement): { hasFiles: () => boolean } {
  root.innerHTML = MARKUP;
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;
  const drop = $<HTMLDivElement>('#drop');
  const fileInput = $<HTMLInputElement>('#file-input');
  const list = $<HTMLOListElement>('#file-list');
  const summary = $<HTMLParagraphElement>('#summary');
  const presetSelect = $<HTMLSelectElement>('#preset');
  const downloadBtn = $<HTMLButtonElement>('#download');
  const printBtn = $<HTMLButtonElement>('#print');
  const sheetStatus = $<HTMLParagraphElement>('#sheet-status');
  const preview = $<HTMLIFrameElement>('#preview');

  // Один Web Worker pdf.js на всё приложение, а не по воркеру на каждый файл пачки.
  const pdfWorker = new PDFWorker();
  let entries: FileEntry[] = [];
  let presetId = DEFAULT_PRESET_ID;
  let pdfUrl: string | null = null;
  let renderToken = 0;
  let fontBytes: Promise<Uint8Array> | null = null;

  const loadFont = () =>
    (fontBytes ??= fetch(robotoUrl)
      .then((r) => {
        if (!r.ok) throw new Error('Не удалось загрузить шрифт');
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b)));

  for (const preset of PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent =
      preset.fragmentScale < 1 ? `${preset.title} (фрагмент уменьшен — риск для сканера)` : preset.title;
    presetSelect.append(option);
  }
  presetSelect.value = presetId;

  function setStatus(text: string, isError = false): void {
    sheetStatus.textContent = text;
    sheetStatus.classList.toggle('error', isError);
  }

  function setPdf(bytes: Uint8Array | null): void {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = bytes ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })) : null;
    if (pdfUrl) preview.src = pdfUrl;
    else preview.removeAttribute('src');
    downloadBtn.disabled = !pdfUrl;
    printBtn.disabled = !pdfUrl;
  }

  function entryRow(entry: FileEntry, position: number, dups: Set<string>): HTMLLIElement {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = entry.id;

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(position + 1);

    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = entry.fileName;
    const status = document.createElement('div');
    status.className = `status ${entry.status}`;
    if (entry.status === 'pending') status.textContent = 'обработка…';
    else if (entry.status === 'error') status.textContent = `✗ ${entry.error}`;
    else status.textContent = `✓ ${entry.shipment!.trackNumber} → ${entry.shipment!.recipient.name}`;
    body.append(name, status);
    if (entry.status === 'ok' && dups.has(entry.shipment!.trackNumber)) {
      const warn = document.createElement('div');
      warn.className = 'warn';
      warn.textContent = '⚠ Такой трек-номер уже есть в списке';
      body.append(warn);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Убрать ${entry.fileName}`);
    remove.addEventListener('click', () => {
      entries = removeEntry(entries, entry.id);
      renderList();
      void rebuildSheet();
    });

    li.addEventListener('dragstart', (ev) => ev.dataTransfer?.setData('application/x-entry-id', entry.id));
    li.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer?.types.includes('application/x-entry-id')) return;
      ev.preventDefault();
      li.classList.add('is-drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('is-drag-over'));
    li.addEventListener('drop', (ev) => {
      const fromId = ev.dataTransfer?.getData('application/x-entry-id');
      li.classList.remove('is-drag-over');
      if (!fromId) return;
      ev.preventDefault();
      ev.stopPropagation();
      entries = moveEntry(entries, fromId, entry.id);
      renderList();
      void rebuildSheet();
    });

    li.append(num, body, remove);
    return li;
  }

  function renderList(): void {
    const dups = duplicateTracks(entries);
    list.replaceChildren(...entries.map((e, i) => entryRow(e, i, dups)));
    const ready = readyShipments(entries).length;
    const errors = entries.filter((e) => e.status === 'error').length;
    summary.textContent = entries.length
      ? `Файлов: ${entries.length}, готово: ${ready}${errors ? `, с ошибкой: ${errors}` : ''}`
      : '';
  }

  async function rebuildSheet(): Promise<void> {
    const token = ++renderToken;
    const shipments = readyShipments(entries);
    if (shipments.length === 0) {
      setPdf(null);
      setStatus('');
      return;
    }
    setStatus('Собираю PDF…');
    try {
      const bytes = await renderSheet({ shipments, preset: getPreset(presetId), fontBytes: await loadFont() });
      if (token !== renderToken) return;
      setPdf(bytes);
      setStatus(`Отправлений в листе: ${shipments.length}`);
    } catch (e) {
      if (token !== renderToken) return;
      setPdf(null);
      setStatus(`Ошибка сборки PDF: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  async function addFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const batch = files.map((file) => ({ id: crypto.randomUUID(), fileName: file.name, file }));
    entries = addPending(entries, batch);
    renderList();
    try {
      await mapWithLimit(batch, EXTRACT_CONCURRENCY, async ({ id, file }) => {
        // Сначала дождаться результата: `entries` нужно читать уже после await, иначе параллельные
        // разборы затирают результаты друг друга.
        const result = await extractFile(file, pdfWorker);
        entries = resolveEntry(entries, id, result);
        renderList();
      });
    } finally {
      await rebuildSheet();
    }
  }

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    void addFiles(Array.from(fileInput.files ?? []));
    fileInput.value = '';
  });
  drop.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('is-over');
    void addFiles(Array.from(ev.dataTransfer?.files ?? []));
  });
  // Файл, брошенный мимо зоны, не должен открываться браузером вместо приложения.
  window.addEventListener('dragover', (ev) => ev.preventDefault());
  window.addEventListener('drop', (ev) => ev.preventDefault());

  presetSelect.addEventListener('change', () => {
    presetId = presetSelect.value;
    void rebuildSheet();
  });

  downloadBtn.addEventListener('click', () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = sheetFileName(new Date());
    a.click();
  });

  printBtn.addEventListener('click', () => {
    if (!pdfUrl) return;
    try {
      preview.contentWindow?.focus();
      preview.contentWindow?.print();
    } catch {
      window.open(pdfUrl, '_blank');
    }
  });

  renderList();

  return { hasFiles: () => entries.length > 0 };
}
