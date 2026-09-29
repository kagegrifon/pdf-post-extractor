# PDF Post Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Офлайн-PWA, которое из пачки PDF-бланков Почты России собирает PDF для печати: таблица реквизитов + вырезаемые фрагменты QR/марка/штрихкод без потери качества.

**Architecture:** Чистый клиент на Vite + TypeScript без фреймворка. `extract` читает текст бланка через pdf.js (legacy-сборка) по зонам шаблона; `layout` — чистая функция раскладки по пресету; `render` через pdf-lib вставляет фрагмент исходной страницы как Form XObject (`embedPage` с `boundingBox`) — без растеризации; тонкий DOM-UI; `vite-plugin-pwa` в режиме `prompt` для офлайна и обновлений.

**Tech Stack:** Vite 8, TypeScript 7, Vitest 5, pdfjs-dist 6 (legacy build), pdf-lib 1.17 + @pdf-lib/fontkit, roboto-fontface (WOFF), vite-plugin-pwa 1.3, @vite-pwa/assets-generator; тесты: @napi-rs/canvas + zxing-wasm.

**Spec:** `docs/superpowers/specs/2026-09-29-pdf-post-extractor-design.md`

## Global Constraints

- Стек: Vite + TypeScript, **без UI-фреймворка**. Сервера нет, файлы пользователя никуда не отправляются (никаких `fetch` наружу, кроме собственных ассетов приложения).
- pdf.js импортируется **только** из `pdfjs-dist/legacy/build/pdf.mjs` (основная сборка 6.x требует `Uint8Array.prototype.toHex` и падает в Node 24 и в не самых свежих браузерах — проверено).
- Worker pdf.js в браузере: `pdfjs-dist/legacy/build/pdf.worker.min.mjs?url`.
- В `getDocument` всегда передаётся **копия** байтов (`bytes.slice()`) — pdf.js забирает (detach) переданный буфер.
- Фрагмент **никогда не растрируется**: только `PDFDocument.embedPage(page, boundingBox)` + `drawPage`.
- Вырезка шаблона `russian-post-envelope-v1`: `crop = { x: 366, y: 8, width: 218, height: 158 }` pt, начало координат — левый верхний угол страницы (проверено рендером всех трёх примеров: QR, марка, штрихкод, цифры, поле тишины, ничего лишнего).
- Размер страницы шаблона: 623.6 × 311.8 pt, допуск ±1 pt.
- `fragmentScale` по умолчанию `1.0`.
- Все тексты UI и сообщения об ошибках — на русском.
- В UI постоянно видна подсказка: «Печатайте в масштабе 100% (не „по размеру страницы“)».
- `data/` в `.gitignore` и **никогда** не коммитится; реальные реквизиты не попадают в репозиторий, в том числе в тесты (ожидаемые значения для реальных файлов — в `data/expected.json`, тоже игнорируется).
- Шрифт таблицы: `roboto-fontface/fonts/roboto/Roboto-Regular.woff`, встраивается с `subset: true`.
- Имя итогового файла: `otpravleniya-YYYY-MM-DD.pdf`.
- Коммиты заканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Очень длинные реквизиты** (название на 3 строки, длинный адрес) — текст не вылезает за ячейку и не залезает на фрагмент, последняя строка обрезается «…». Тест: Task 5 (`fitParagraphs`) и Task 6 (рендер длинного адреса).
2. **Символы, которых нет в шрифте** (эмодзи, редкие знаки в названии организации) — PDF собирается, вместо символа печатается `?`, а не пустой квадрат. Тест: Task 5 (`sanitizeText`) и Task 6.
3. **Повёрнутая страница** (`/Rotate 90`) при правильном размере — отклоняется как неизвестный формат, а не печатает неверный кусок. Тест: Task 3.
4. **Файл удалён из списка, пока ещё обрабатывается** — он не «воскресает» после окончания разбора. Тест: Task 7 (`resolveEntry` по отсутствующему id).
5. **Пустой (0 байт) или не-PDF файл в пачке** (jpg, docx) — понятная ошибка у этого файла, остальные обрабатываются. Тест: Task 3.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, index.html, README.md
public/icon.svg (+ сгенерированные иконки)
src/
  geometry.ts     — Rect, mmToPt, containsPoint
  template.ts     — шаблон бланка (данные) + findTemplate/getTemplate
  extract.ts      — PDF → Shipment | ошибка
  presets.ts      — пресеты раскладки
  layout.ts       — computeGrid / layoutPages (чистые функции)
  textwrap.ts     — перенос, обрезка, санитизация текста (чистые функции)
  render.ts       — сборка итогового PDF
  state.ts        — чистые операции над списком файлов
  ui/app.ts       — DOM-интерфейс
  pwa.ts          — регистрация SW, плашка обновления
  styles.css, main.ts, env.d.ts
tests/
  fixtures/makeBlank.ts  — синтетический бланк (pdf-lib), без реальных данных
  helpers/realData.ts    — доступ к data/ (skip, если нет)
  helpers/rasterize.ts   — рендер PDF в ImageData + декод штрихкодов
  *.test.ts
```

---

### Task 1: Каркас проекта и геометрия

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/geometry.ts`
- Test: `tests/geometry.test.ts`

**Interfaces:**
- Produces: `interface Rect { x: number; y: number; width: number; height: number }` (pt, начало — левый верхний угол); `PT_PER_MM: number`; `mmToPt(mm: number): number`; `containsPoint(r: Rect, x: number, y: number): boolean`.

- [ ] **Step 1: Создать `package.json` и установить зависимости**

```json
{
  "name": "pdf-post-extractor",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

Run:
```bash
npm i pdfjs-dist pdf-lib @pdf-lib/fontkit roboto-fontface
npm i -D vite vitest typescript @types/node @napi-rs/canvas zxing-wasm
```
Expected: установка без ошибок; `package.json` получил `dependencies` и `devDependencies`.

- [ ] **Step 2: Создать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 3: Создать `vite.config.ts`, `index.html`, `src/main.ts`**

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
```

`index.html`:
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Отправления — печать фрагментов</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`:
```ts
document.getElementById('app')!.textContent = 'Загрузка…';
```

- [ ] **Step 4: Написать падающий тест `tests/geometry.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { containsPoint, mmToPt, PT_PER_MM } from '../src/geometry';

describe('geometry', () => {
  it('converts millimetres to points', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
    expect(PT_PER_MM).toBeCloseTo(2.834645, 5);
  });

  it('containsPoint includes edges and excludes outside points', () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(containsPoint(r, 10, 20)).toBe(true);
    expect(containsPoint(r, 40, 60)).toBe(true);
    expect(containsPoint(r, 25, 30)).toBe(true);
    expect(containsPoint(r, 9.9, 30)).toBe(false);
    expect(containsPoint(r, 25, 60.1)).toBe(false);
  });
});
```

- [ ] **Step 5: Запустить — убедиться, что падает**

Run: `npx vitest run tests/geometry.test.ts`
Expected: FAIL — `Failed to resolve import "../src/geometry"`.

- [ ] **Step 6: Реализовать `src/geometry.ts`**

```ts
/** Прямоугольник в pt, начало координат — левый верхний угол страницы. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}
```

- [ ] **Step 7: Проверить тесты, типы и dev-сервер**

Run: `npx vitest run tests/geometry.test.ts` → Expected: PASS (2 tests).
Run: `npm run typecheck` → Expected: без ошибок.
Run: `npx vite build` → Expected: сборка в `dist/` без ошибок.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src tests
git commit -m "chore: scaffold Vite + TypeScript project with geometry helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Шаблон бланка

**Files:**
- Create: `src/template.ts`
- Test: `tests/template.test.ts`

**Interfaces:**
- Consumes: `Rect` из `src/geometry.ts`.
- Produces:
  - `type ZoneName = 'senderName' | 'senderAddress' | 'senderIndex' | 'recipientName' | 'recipientAddress' | 'recipientIndex' | 'track'`
  - `interface BlankTemplate { id: string; pageSize: { width: number; height: number }; zones: Record<ZoneName, Rect>; crop: Rect }`
  - `RUSSIAN_POST_ENVELOPE: BlankTemplate`, `TEMPLATES: BlankTemplate[]`
  - `findTemplate(width: number, height: number): BlankTemplate | undefined`
  - `getTemplate(id: string): BlankTemplate` (бросает `Error` для неизвестного id)

Координаты зон выведены из реальных образцов: базовые линии текста (top-left) — имя отправителя 21.8, адрес 60.8, индекс 114.8 (x 190); трек 160.5 (x 433.6); имя получателя 177.3, адрес 215.8 и 234.5 (вторая строка начинается с x 342), индекс 289.8 (x 383). Дубль индекса `$NNNNNN` (шрифт PostIndex) — базовая линия 279.8 при x 25, вне зон. Границы между «имя» и «адрес» проходят по линиям бланка (≈ 44 и ≈ 199 pt), чтобы двухстрочное название не попало в адрес.

- [ ] **Step 1: Написать падающий тест `tests/template.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { containsPoint } from '../src/geometry';
import { findTemplate, getTemplate, RUSSIAN_POST_ENVELOPE, TEMPLATES } from '../src/template';

describe('template', () => {
  it('finds the envelope template by page size with 1pt tolerance', () => {
    expect(findTemplate(623.6, 311.8)).toBe(RUSSIAN_POST_ENVELOPE);
    expect(findTemplate(624.4, 311.0)).toBe(RUSSIAN_POST_ENVELOPE);
    expect(findTemplate(595.28, 841.89)).toBeUndefined();
  });

  it('getTemplate returns by id and throws for unknown id', () => {
    expect(getTemplate('russian-post-envelope-v1')).toBe(RUSSIAN_POST_ENVELOPE);
    expect(() => getTemplate('nope')).toThrow();
  });

  it('crop lies inside the page', () => {
    for (const t of TEMPLATES) {
      expect(t.crop.x).toBeGreaterThanOrEqual(0);
      expect(t.crop.y).toBeGreaterThanOrEqual(0);
      expect(t.crop.x + t.crop.width).toBeLessThanOrEqual(t.pageSize.width);
      expect(t.crop.y + t.crop.height).toBeLessThanOrEqual(t.pageSize.height);
    }
  });

  it('zones contain the baselines observed in real samples', () => {
    const z = RUSSIAN_POST_ENVELOPE.zones;
    expect(containsPoint(z.senderName, 53, 21.8)).toBe(true);
    expect(containsPoint(z.senderAddress, 53, 60.8)).toBe(true);
    expect(containsPoint(z.senderIndex, 190, 114.8)).toBe(true);
    expect(containsPoint(z.track, 433.6, 160.5)).toBe(true);
    expect(containsPoint(z.recipientName, 367, 177.3)).toBe(true);
    expect(containsPoint(z.recipientAddress, 367, 215.8)).toBe(true);
    expect(containsPoint(z.recipientAddress, 342, 234.5)).toBe(true);
    expect(containsPoint(z.recipientIndex, 383, 289.8)).toBe(true);
  });

  it('no zone contains the PostIndex duplicate at (25, 279.8)', () => {
    for (const zone of Object.values(RUSSIAN_POST_ENVELOPE.zones)) {
      expect(containsPoint(zone, 25, 279.8)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/template.test.ts`
Expected: FAIL — `Failed to resolve import "../src/template"`.

- [ ] **Step 3: Реализовать `src/template.ts`**

```ts
import type { Rect } from './geometry';

export type ZoneName =
  | 'senderName'
  | 'senderAddress'
  | 'senderIndex'
  | 'recipientName'
  | 'recipientAddress'
  | 'recipientIndex'
  | 'track';

export interface BlankTemplate {
  id: string;
  /** pt */
  pageSize: { width: number; height: number };
  /** Зоны проверяются по точке начала базовой линии текста. */
  zones: Record<ZoneName, Rect>;
  /** Вырезаемый фрагмент: QR, марка, штрихкод, трек и поле тишины. */
  crop: Rect;
}

export const PAGE_SIZE_TOLERANCE = 1;

export const RUSSIAN_POST_ENVELOPE: BlankTemplate = {
  id: 'russian-post-envelope-v1',
  pageSize: { width: 623.6, height: 311.8 },
  zones: {
    senderName: { x: 30, y: 5, width: 300, height: 39 },
    senderAddress: { x: 30, y: 44, width: 300, height: 51 },
    senderIndex: { x: 150, y: 95, width: 180, height: 30 },
    track: { x: 400, y: 145, width: 170, height: 20 },
    recipientName: { x: 330, y: 166, width: 293.6, height: 33 },
    recipientAddress: { x: 330, y: 199, width: 293.6, height: 63 },
    recipientIndex: { x: 340, y: 265, width: 283.6, height: 35 },
  },
  crop: { x: 366, y: 8, width: 218, height: 158 },
};

export const TEMPLATES: BlankTemplate[] = [RUSSIAN_POST_ENVELOPE];

export function findTemplate(width: number, height: number): BlankTemplate | undefined {
  return TEMPLATES.find(
    (t) =>
      Math.abs(t.pageSize.width - width) <= PAGE_SIZE_TOLERANCE &&
      Math.abs(t.pageSize.height - height) <= PAGE_SIZE_TOLERANCE,
  );
}

export function getTemplate(id: string): BlankTemplate {
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`Неизвестный шаблон бланка: ${id}`);
  return template;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npx vitest run tests/template.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/template.ts tests/template.test.ts
git commit -m "feat: add Russian Post envelope blank template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Извлечение реквизитов (`extract.ts`)

**Files:**
- Create: `src/extract.ts`, `tests/fixtures/makeBlank.ts`, `tests/helpers/realData.ts`
- Create (локально, не коммитится): `data/expected.json`
- Test: `tests/extract.test.ts`

**Interfaces:**
- Consumes: `Rect`, `containsPoint` (Task 1); `BlankTemplate`, `findTemplate` (Task 2).
- Produces:
  - `interface Party { name: string; address: string; index: string }`
  - `interface Shipment { fileName: string; templateId: string; sender: Party; recipient: Party; trackNumber: string; pdfBytes: Uint8Array }`
  - `type ExtractErrorCode = 'unreadable' | 'encrypted' | 'unsupported-pages' | 'unknown-format'`
  - `interface ExtractError { code: ExtractErrorCode; message: string }`
  - `type ExtractResult = { ok: true; shipment: Shipment } | { ok: false; fileName: string; error: ExtractError }`
  - `interface PositionedText { str: string; x: number; y: number }` (x, y — начало базовой линии, top-left, pt)
  - `classifyOpenError(e: unknown): ExtractError`
  - `collectZoneLines(items: PositionedText[], zone: Rect): string[]`
  - `extractShipment(fileName: string, bytes: Uint8Array): Promise<ExtractResult>`
  - Тестовые хелперы: `makeBlank(spec?: BlankSpec): Promise<Uint8Array>`, `DEFAULT_TEXTS`, `ROBOTO_PATH`; `realDataAvailable: boolean`, `realFiles(): { name: string; bytes: Uint8Array }[]`, `realExpected(): Record<string, { sender: Party; recipient: Party; trackNumber: string }>`

- [ ] **Step 1: Синтетический бланк `tests/fixtures/makeBlank.ts`**

Повторяет геометрию реального бланка (координаты базовых линий из образцов), но с выдуманными данными и без картинок.

```ts
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { degrees, PDFDocument } from 'pdf-lib';

export const ROBOTO_PATH = path.resolve('node_modules/roboto-fontface/fonts/roboto/Roboto-Regular.woff');

export type BlankField =
  | 'senderName'
  | 'senderAddress'
  | 'senderIndex'
  | 'recipientName'
  | 'recipientAddress'
  | 'recipientIndex'
  | 'track';

export const DEFAULT_TEXTS: Record<BlankField, string> = {
  senderName: 'ООО "Тест-Отправитель"',
  senderAddress: 'г. Тестовск, ул. Первая, д. 1',
  senderIndex: '101000',
  recipientName: 'ИП Проверкин',
  recipientAddress: 'г. Примерск, пр. Второй, д. 2',
  recipientIndex: '202000',
  track: '12345678901234',
};

/** Начало базовой линии (top-left, pt) и кегль — как в реальных бланках. */
const POSITIONS: Record<BlankField, { x: number; y: number; size: number }> = {
  senderName: { x: 53, y: 21.8, size: 11 },
  senderAddress: { x: 53, y: 60.8, size: 11 },
  senderIndex: { x: 190, y: 114.8, size: 13 },
  recipientName: { x: 367, y: 177.3, size: 11 },
  recipientAddress: { x: 367, y: 215.8, size: 11 },
  recipientIndex: { x: 383, y: 289.8, size: 13 },
  track: { x: 433.6, y: 160.5, size: 11.3 },
};

export interface BlankSpec {
  pageSize?: [number, number];
  pages?: number;
  rotation?: number;
  texts?: Partial<Record<BlankField, string>>;
  /** Вторая строка адреса получателя, как в реальном образце (x 342, y 234.5). */
  recipientAddressLine2?: string;
  /** Сдвинуть все тексты (имитация другой версии генератора). */
  shift?: { dx: number; dy: number };
}

export async function makeBlank(spec: BlankSpec = {}): Promise<Uint8Array> {
  const [width, height] = spec.pageSize ?? [623.6, 311.8];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(ROBOTO_PATH), { subset: true });
  const pages = Array.from({ length: spec.pages ?? 1 }, () => doc.addPage([width, height]));
  const page = pages[0];
  if (spec.rotation) page.setRotation(degrees(spec.rotation));
  const dx = spec.shift?.dx ?? 0;
  const dy = spec.shift?.dy ?? 0;
  const texts = { ...DEFAULT_TEXTS, ...spec.texts };
  const draw = (text: string, x: number, y: number, size: number) =>
    page.drawText(text, { x: x + dx, y: height - (y + dy), size, font });

  for (const field of Object.keys(POSITIONS) as BlankField[]) {
    const text = texts[field];
    if (!text) continue;
    const p = POSITIONS[field];
    draw(text, p.x, p.y, p.size);
  }
  if (spec.recipientAddressLine2) draw(spec.recipientAddressLine2, 342, 234.5, 11);
  // Дубль индекса получателя крупным шрифтом, как PostIndex в оригинале.
  if (texts.recipientIndex) draw(`$${texts.recipientIndex}`, 25, 279.8, 48);
  return doc.save();
}
```

- [ ] **Step 2: Хелпер реальных данных `tests/helpers/realData.ts` и `data/expected.json`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Party } from '../../src/extract';

const DATA_DIR = path.resolve('data');
const EXPECTED_PATH = path.join(DATA_DIR, 'expected.json');

export const realDataAvailable = fs.existsSync(EXPECTED_PATH);

export function realFiles(): { name: string; bytes: Uint8Array }[] {
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(DATA_DIR, name))) }));
}

export function realExpected(): Record<string, { sender: Party; recipient: Party; trackNumber: string }> {
  return JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
}
```

Создать `data/expected.json` (директория `data/` в `.gitignore` — файл **не коммитится**). Значения сверены с текстовым слоем образцов:

```json
{
  "blank - 2026-09-29T204310.990.pdf": {
    "sender": { "name": "ООО \"Тест-Отправитель\"", "address": "г. Тестовск, ул. Первая, д. 1", "index": "101000" },
    "recipient": { "name": "ИП Проверкин", "address": "г. Примерск, пр. Второй, д. 2", "index": "202000" },
    "trackNumber": "10000000000001"
  },
  "blank - 2026-09-29T204549.908.pdf": {
    "sender": { "name": "ООО \"Тест-Отправитель\"", "address": "г. Тестовск, ул. Первая, д. 1", "index": "101000" },
    "recipient": { "name": "ООО \"Образец\"", "address": "ул. Примерная, д. 5, стр. 3, г. Столичный", "index": "303000" },
    "trackNumber": "10000000000002"
  },
  "blank - 2026-09-29T204749.923.pdf": {
    "sender": { "name": "ООО \"Тест-Отправитель\"", "address": "г. Тестовск, ул. Первая, д. 1", "index": "101000" },
    "recipient": { "name": "АО \"Образец-Два\"", "address": "ул. Учебная, д. 2, г. Примерный, обл. Показательная", "index": "404000" },
    "trackNumber": "10000000000003"
  }
}
```

Run: `git status --short` → Expected: `data/expected.json` **не** показан.

- [ ] **Step 3: Написать падающий тест `tests/extract.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { classifyOpenError, collectZoneLines, extractShipment } from '../src/extract';
import { DEFAULT_TEXTS, makeBlank } from './fixtures/makeBlank';
import { realDataAvailable, realExpected, realFiles } from './helpers/realData';

async function extractOk(bytes: Uint8Array) {
  const res = await extractShipment('test.pdf', bytes);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.shipment;
}

async function extractErr(bytes: Uint8Array) {
  const res = await extractShipment('test.pdf', bytes);
  if (res.ok) throw new Error('expected error');
  return res.error;
}

describe('collectZoneLines', () => {
  const zone = { x: 0, y: 0, width: 100, height: 100 };

  it('orders lines top-to-bottom then left-to-right, drops empty and $-prefixed items', () => {
    const lines = collectZoneLines(
      [
        { str: 'вторая', x: 5, y: 50 },
        { str: '', x: 5, y: 10 },
        { str: 'правая', x: 60, y: 10.4 },
        { str: 'первая', x: 5, y: 10 },
        { str: '$123456', x: 5, y: 70 },
        { str: 'снаружи', x: 150, y: 10 },
      ],
      zone,
    );
    expect(lines).toEqual(['первая', 'правая', 'вторая']);
  });
});

describe('classifyOpenError', () => {
  it('maps PasswordException to encrypted and anything else to unreadable', () => {
    expect(classifyOpenError({ name: 'PasswordException' }).code).toBe('encrypted');
    expect(classifyOpenError(new Error('boom')).code).toBe('unreadable');
    expect(classifyOpenError(undefined).code).toBe('unreadable');
  });
});

describe('extractShipment (synthetic blank)', () => {
  it('extracts sender, recipient and track', async () => {
    const s = await extractOk(await makeBlank());
    expect(s.templateId).toBe('russian-post-envelope-v1');
    expect(s.sender).toEqual({
      name: DEFAULT_TEXTS.senderName,
      address: DEFAULT_TEXTS.senderAddress,
      index: DEFAULT_TEXTS.senderIndex,
    });
    expect(s.recipient).toEqual({
      name: DEFAULT_TEXTS.recipientName,
      address: DEFAULT_TEXTS.recipientAddress,
      index: DEFAULT_TEXTS.recipientIndex,
    });
    expect(s.trackNumber).toBe(DEFAULT_TEXTS.track);
  });

  it('joins the second address line that starts further left', async () => {
    const s = await extractOk(await makeBlank({ recipientAddressLine2: 'Свердловская' }));
    expect(s.recipient.address).toBe(`${DEFAULT_TEXTS.recipientAddress} Свердловская`);
  });

  it('keeps original bytes usable after extraction', async () => {
    const bytes = await makeBlank();
    const length = bytes.length;
    const s = await extractOk(bytes);
    expect(s.pdfBytes.length).toBe(length);
    expect(bytes.length).toBe(length);
  });

  it('rejects wrong page size as unknown-format', async () => {
    const e = await extractErr(await makeBlank({ pageSize: [595.28, 841.89] }));
    expect(e.code).toBe('unknown-format');
  });

  it('rejects multi-page documents', async () => {
    const e = await extractErr(await makeBlank({ pages: 2 }));
    expect(e.code).toBe('unsupported-pages');
    expect(e.message).toBe('Ожидается одностраничный бланк');
  });

  it('rejects a blank without track number and says what is missing', async () => {
    const e = await extractErr(await makeBlank({ texts: { track: '' } }));
    expect(e.code).toBe('unknown-format');
    expect(e.message).toContain('трек-номер');
  });

  it('rejects a blank whose text is shifted out of the zones', async () => {
    const e = await extractErr(await makeBlank({ shift: { dx: 0, dy: 40 } }));
    expect(e.code).toBe('unknown-format');
  });

  // Review Focus #3
  it('rejects a rotated page as unknown-format', async () => {
    const e = await extractErr(await makeBlank({ rotation: 90 }));
    expect(e.code).toBe('unknown-format');
    expect(e.message).toContain('повёрнута');
  });

  // Review Focus #5
  it('reports garbage, empty and non-PDF bytes as unreadable', async () => {
    expect((await extractErr(new Uint8Array([1, 2, 3]))).code).toBe('unreadable');
    expect((await extractErr(new Uint8Array(0))).code).toBe('unreadable');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const e = await extractErr(png);
    expect(e.code).toBe('unreadable');
    expect(e.message).toBe('Не удалось прочитать файл');
  });
});

describe.skipIf(!realDataAvailable)('extractShipment (real samples in data/)', () => {
  it('matches data/expected.json for every sample', async () => {
    const expected = realExpected();
    const files = realFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const res = await extractShipment(file.name, file.bytes);
      if (!res.ok) throw new Error(`${file.name}: ${res.error.message}`);
      const { sender, recipient, trackNumber } = res.shipment;
      expect({ sender, recipient, trackNumber }).toEqual(expected[file.name]);
    }
  });
});
```

- [ ] **Step 4: Запустить — убедиться, что падает**

Run: `npx vitest run tests/extract.test.ts`
Expected: FAIL — `Failed to resolve import "../src/extract"`.

- [ ] **Step 5: Реализовать `src/extract.ts`**

```ts
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { containsPoint, type Rect } from './geometry';
import { findTemplate, type BlankTemplate } from './template';

export interface Party {
  name: string;
  address: string;
  index: string;
}

export interface Shipment {
  fileName: string;
  templateId: string;
  sender: Party;
  recipient: Party;
  trackNumber: string;
  pdfBytes: Uint8Array;
}

export type ExtractErrorCode = 'unreadable' | 'encrypted' | 'unsupported-pages' | 'unknown-format';

export interface ExtractError {
  code: ExtractErrorCode;
  message: string;
}

export type ExtractResult =
  | { ok: true; shipment: Shipment }
  | { ok: false; fileName: string; error: ExtractError };

/** Текст с началом базовой линии в координатах top-left, pt. */
export interface PositionedText {
  str: string;
  x: number;
  y: number;
}

const MESSAGES: Record<ExtractErrorCode, string> = {
  unreadable: 'Не удалось прочитать файл',
  encrypted: 'Файл защищён паролем',
  'unsupported-pages': 'Ожидается одностраничный бланк',
  'unknown-format': 'Неизвестный формат бланка',
};

function makeError(code: ExtractErrorCode, detail?: string): ExtractError {
  return { code, message: detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code] };
}

export function classifyOpenError(e: unknown): ExtractError {
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  return makeError(name === 'PasswordException' ? 'encrypted' : 'unreadable');
}

export function collectZoneLines(items: PositionedText[], zone: Rect): string[] {
  return items
    .filter((i) => i.str.trim() !== '' && !i.str.startsWith('$') && containsPoint(zone, i.x, i.y))
    .sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x - b.x)
    .map((i) => i.str.trim());
}

type Parsed =
  | { ok: true; sender: Party; recipient: Party; trackNumber: string }
  | { ok: false; error: ExtractError };

function parseItems(items: PositionedText[], template: BlankTemplate): Parsed {
  const z = template.zones;
  const text = (zone: Rect) => collectZoneLines(items, zone).join(' ');
  const sender: Party = { name: text(z.senderName), address: text(z.senderAddress), index: text(z.senderIndex) };
  const recipient: Party = {
    name: text(z.recipientName),
    address: text(z.recipientAddress),
    index: text(z.recipientIndex),
  };
  const trackNumber = text(z.track).replace(/\s/g, '');

  const missing: string[] = [];
  if (!/^\d{14}$/.test(trackNumber)) missing.push('трек-номер');
  if (!sender.name) missing.push('отправитель');
  if (!/^\d{6}$/.test(sender.index)) missing.push('индекс отправителя');
  if (!recipient.name) missing.push('получатель');
  if (!/^\d{6}$/.test(recipient.index)) missing.push('индекс получателя');
  if (missing.length) return { ok: false, error: makeError('unknown-format', `не найдено: ${missing.join(', ')}`) };
  return { ok: true, sender, recipient, trackNumber };
}

export async function extractShipment(fileName: string, bytes: Uint8Array): Promise<ExtractResult> {
  const fail = (error: ExtractError): ExtractResult => ({ ok: false, fileName, error });

  let doc: PDFDocumentProxy;
  try {
    // pdf.js забирает переданный буфер — отдаём копию, оригинал нужен для render.
    doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  } catch (e) {
    return fail(classifyOpenError(e));
  }

  try {
    if (doc.numPages !== 1) return fail(makeError('unsupported-pages'));
    const page = await doc.getPage(1);
    if (page.rotate % 360 !== 0) return fail(makeError('unknown-format', 'страница повёрнута'));

    const [x0, y0, x1, y1] = page.view;
    const width = x1 - x0;
    const height = y1 - y0;
    const template = findTemplate(width, height);
    if (!template) {
      return fail(makeError('unknown-format', `размер страницы ${Math.round(width)}×${Math.round(height)} pt`));
    }

    const content = await page.getTextContent();
    const items: PositionedText[] = content.items.flatMap((item) =>
      'str' in item ? [{ str: item.str, x: item.transform[4] - x0, y: y1 - item.transform[5] }] : [],
    );

    const parsed = parseItems(items, template);
    if (!parsed.ok) return fail(parsed.error);
    return {
      ok: true,
      shipment: {
        fileName,
        templateId: template.id,
        sender: parsed.sender,
        recipient: parsed.recipient,
        trackNumber: parsed.trackNumber,
        pdfBytes: bytes,
      },
    };
  } catch (e) {
    return fail(classifyOpenError(e));
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 6: Запустить — убедиться, что проходит**

Run: `npx vitest run tests/extract.test.ts`
Expected: PASS — все тесты, включая блок «real samples» (если `data/expected.json` есть локально). Если ругается на порядок строк реального образца — сверить с `data/expected.json`, **не** подгонять ожидания под вывод без проверки глазами на PDF.

Run: `npm run typecheck` → Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
git add src/extract.ts tests/extract.test.ts tests/fixtures/makeBlank.ts tests/helpers/realData.ts
git status --short   # убедиться, что data/ не попал в индекс
git commit -m "feat: extract sender, recipient and track from blank PDFs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Пресеты и раскладка (`presets.ts`, `layout.ts`)

**Files:**
- Create: `src/presets.ts`, `src/layout.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Consumes: `Rect`, `mmToPt` (Task 1).
- Produces:
  - `interface LayoutPreset { id: string; title: string; page: { width: number; height: number }; margins: number; columns: number; cellGap: number; textGap: number; fragmentScale: number; fontSize: number; printNumberOnFragment: boolean }` (размеры в мм, `fontSize` в pt)
  - `PRESETS: LayoutPreset[]`, `DEFAULT_PRESET_ID: string`, `getPreset(id: string): LayoutPreset`
  - `interface Size { width: number; height: number }`
  - `interface Grid { columns: number; rows: number; perPage: number; pageWidth: number; pageHeight: number; margin: number; gap: number; cellWidth: number; cellHeight: number; fragmentWidth: number; fragmentHeight: number; textWidth: number }` (pt)
  - `interface CellLayout { index: number; cell: Rect; text: Rect; fragment: Rect }` (`index` — сквозной, с 0)
  - `interface PageLayout { width: number; height: number; cells: CellLayout[] }`
  - `class LayoutError extends Error`, `MIN_TEXT_WIDTH_MM = 30`
  - `computeGrid(preset: LayoutPreset, fragment: Size): Grid`
  - `layoutPages(count: number, preset: LayoutPreset, fragment: Size): PageLayout[]`

Расчёт для фрагмента 218 × 158 pt (76.9 × 55.7 мм): альбомный пресет — 2 × 3, текст ≈ 59.6 мм; книжный — 1 × 5 (5 × 55.74 + 4 × 2 = 286.7 мм ≤ 287 мм).

- [ ] **Step 1: Написать падающий тест `tests/layout.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mmToPt } from '../src/geometry';
import { computeGrid, layoutPages, LayoutError } from '../src/layout';
import { DEFAULT_PRESET_ID, getPreset, PRESETS, type LayoutPreset } from '../src/presets';

const FRAGMENT = { width: 218, height: 158 };
const landscape = getPreset('a4-landscape-2');
const portrait = getPreset('a4-portrait-1');

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('presets', () => {
  it('default preset exists and ids are unique', () => {
    expect(getPreset(DEFAULT_PRESET_ID).id).toBe('a4-landscape-2');
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(() => getPreset('nope')).toThrow();
  });
});

describe('computeGrid', () => {
  it('landscape A4 fits 2 columns x 3 rows with ~60mm text column', () => {
    const g = computeGrid(landscape, FRAGMENT);
    expect([g.columns, g.rows, g.perPage]).toEqual([2, 3, 6]);
    expect(g.textWidth).toBeGreaterThan(mmToPt(59));
    expect(g.textWidth).toBeLessThan(mmToPt(60.5));
  });

  it('portrait A4 fits 1 column x 5 rows', () => {
    const g = computeGrid(portrait, FRAGMENT);
    expect([g.columns, g.rows, g.perPage]).toEqual([1, 5, 5]);
  });

  it('smaller fragmentScale gives more rows', () => {
    const g = computeGrid({ ...portrait, fragmentScale: 0.5 }, FRAGMENT);
    expect(g.rows).toBeGreaterThan(5);
    expect(g.fragmentHeight).toBeCloseTo(79, 6);
  });

  it('throws LayoutError when fragment does not fit vertically', () => {
    expect(() => computeGrid(landscape, { width: 218, height: 1000 })).toThrow(LayoutError);
  });

  it('throws LayoutError when text column is too narrow', () => {
    const narrow: LayoutPreset = { ...portrait, columns: 2 };
    expect(() => computeGrid(narrow, FRAGMENT)).toThrow(LayoutError);
  });
});

describe('layoutPages', () => {
  it('returns no pages for zero shipments', () => {
    expect(layoutPages(0, landscape, FRAGMENT)).toEqual([]);
  });

  it.each([
    [1, [1]],
    [6, [6]],
    [7, [6, 1]],
    [13, [6, 6, 1]],
  ])('%i shipments -> cells per page %j', (count, perPage) => {
    const pages = layoutPages(count, landscape, FRAGMENT);
    expect(pages.map((p) => p.cells.length)).toEqual(perPage);
    expect(pages.flatMap((p) => p.cells.map((c) => c.index))).toEqual([...Array(count).keys()]);
  });

  it('fills rows left-to-right, then top-to-bottom', () => {
    const [page] = layoutPages(3, landscape, FRAGMENT);
    const [a, b, c] = page.cells;
    expect(a.cell.y).toBeCloseTo(b.cell.y, 6);
    expect(b.cell.x).toBeGreaterThan(a.cell.x);
    expect(c.cell.y).toBeGreaterThan(a.cell.y);
    expect(c.cell.x).toBeCloseTo(a.cell.x, 6);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: cells stay within margins and never overlap', (_id, preset) => {
    const g = computeGrid(preset, FRAGMENT);
    const [page] = layoutPages(g.perPage, preset, FRAGMENT);
    expect(page.width).toBeCloseTo(mmToPt(preset.page.width), 6);
    expect(page.height).toBeCloseTo(mmToPt(preset.page.height), 6);
    const m = mmToPt(preset.margins);
    for (const c of page.cells) {
      expect(c.fragment.width).toBeCloseTo(FRAGMENT.width * preset.fragmentScale, 6);
      expect(c.fragment.height).toBeCloseTo(FRAGMENT.height * preset.fragmentScale, 6);
      expect(overlaps(c.text, c.fragment)).toBe(false);
      for (const r of [c.text, c.fragment]) {
        expect(r.x).toBeGreaterThanOrEqual(m - 1e-6);
        expect(r.y).toBeGreaterThanOrEqual(m - 1e-6);
        expect(r.x + r.width).toBeLessThanOrEqual(page.width - m + 1e-6);
        expect(r.y + r.height).toBeLessThanOrEqual(page.height - m + 1e-6);
      }
    }
    for (let i = 0; i < page.cells.length; i++) {
      for (let j = i + 1; j < page.cells.length; j++) {
        expect(overlaps(page.cells[i].cell, page.cells[j].cell)).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/layout.test.ts`
Expected: FAIL — `Failed to resolve import "../src/layout"`.

- [ ] **Step 3: Реализовать `src/presets.ts`**

```ts
export interface LayoutPreset {
  id: string;
  title: string;
  /** мм */
  page: { width: number; height: number };
  /** мм, не меньше 5 — зона, которую большинство принтеров не печатает */
  margins: number;
  columns: number;
  /** мм между ячейками — место под рез */
  cellGap: number;
  /** мм между текстом и фрагментом */
  textGap: number;
  /** 1.0 — натуральная величина; уменьшение ухудшает считываемость */
  fragmentScale: number;
  /** pt */
  fontSize: number;
  printNumberOnFragment: boolean;
}

export const PRESETS: LayoutPreset[] = [
  {
    id: 'a4-landscape-2',
    title: 'A4 альбомная, 2 колонки',
    page: { width: 297, height: 210 },
    margins: 7,
    columns: 2,
    cellGap: 4,
    textGap: 3,
    fragmentScale: 1,
    fontSize: 9,
    printNumberOnFragment: true,
  },
  {
    id: 'a4-portrait-1',
    title: 'A4 книжная, 1 колонка',
    page: { width: 210, height: 297 },
    margins: 5,
    columns: 1,
    cellGap: 2,
    textGap: 4,
    fragmentScale: 1,
    fontSize: 9,
    printNumberOnFragment: true,
  },
];

export const DEFAULT_PRESET_ID = 'a4-landscape-2';

export function getPreset(id: string): LayoutPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Неизвестный пресет раскладки: ${id}`);
  return preset;
}
```

- [ ] **Step 4: Реализовать `src/layout.ts`**

```ts
import { mmToPt, type Rect } from './geometry';
import type { LayoutPreset } from './presets';

export interface Size {
  width: number;
  height: number;
}

/** Все размеры в pt. */
export interface Grid {
  columns: number;
  rows: number;
  perPage: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  gap: number;
  cellWidth: number;
  cellHeight: number;
  fragmentWidth: number;
  fragmentHeight: number;
  textWidth: number;
}

export interface CellLayout {
  /** Сквозной номер отправления, с 0. */
  index: number;
  cell: Rect;
  text: Rect;
  fragment: Rect;
}

export interface PageLayout {
  width: number;
  height: number;
  cells: CellLayout[];
}

export class LayoutError extends Error {}

export const MIN_TEXT_WIDTH_MM = 30;

const EPSILON = 1e-6;

export function computeGrid(preset: LayoutPreset, fragment: Size): Grid {
  const pageWidth = mmToPt(preset.page.width);
  const pageHeight = mmToPt(preset.page.height);
  const margin = mmToPt(preset.margins);
  const gap = mmToPt(preset.cellGap);
  const textGap = mmToPt(preset.textGap);
  const fragmentWidth = fragment.width * preset.fragmentScale;
  const fragmentHeight = fragment.height * preset.fragmentScale;

  const usableWidth = pageWidth - 2 * margin;
  const usableHeight = pageHeight - 2 * margin;
  const columns = preset.columns;
  const cellWidth = (usableWidth - gap * (columns - 1)) / columns;
  const cellHeight = fragmentHeight;
  const rows = Math.floor((usableHeight + gap + EPSILON) / (cellHeight + gap));
  const textWidth = cellWidth - fragmentWidth - textGap;

  if (rows < 1) throw new LayoutError(`Фрагмент не помещается по высоте в раскладку «${preset.title}»`);
  if (textWidth < mmToPt(MIN_TEXT_WIDTH_MM)) {
    throw new LayoutError(`Слишком узкая колонка текста в раскладке «${preset.title}»`);
  }

  return {
    columns,
    rows,
    perPage: columns * rows,
    pageWidth,
    pageHeight,
    margin,
    gap,
    cellWidth,
    cellHeight,
    fragmentWidth,
    fragmentHeight,
    textWidth,
  };
}

export function layoutPages(count: number, preset: LayoutPreset, fragment: Size): PageLayout[] {
  if (count <= 0) return [];
  const g = computeGrid(preset, fragment);
  const pages: PageLayout[] = [];

  for (let index = 0; index < count; index++) {
    const slot = index % g.perPage;
    if (slot === 0) pages.push({ width: g.pageWidth, height: g.pageHeight, cells: [] });
    const row = Math.floor(slot / g.columns);
    const col = slot % g.columns;
    const x = g.margin + col * (g.cellWidth + g.gap);
    const y = g.margin + row * (g.cellHeight + g.gap);
    pages[pages.length - 1].cells.push({
      index,
      cell: { x, y, width: g.cellWidth, height: g.cellHeight },
      text: { x, y, width: g.textWidth, height: g.cellHeight },
      fragment: { x: x + g.cellWidth - g.fragmentWidth, y, width: g.fragmentWidth, height: g.fragmentHeight },
    });
  }
  return pages;
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `npx vitest run tests/layout.test.ts`
Expected: PASS (все тесты).

- [ ] **Step 6: Commit**

```bash
git add src/presets.ts src/layout.ts tests/layout.test.ts
git commit -m "feat: add layout presets and page grid computation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Перенос и подготовка текста (`textwrap.ts`)

**Files:**
- Create: `src/textwrap.ts`
- Test: `tests/textwrap.test.ts`

**Interfaces:**
- Produces:
  - `type Measure = (text: string) => number`
  - `wrapText(text: string, maxWidth: number, measure: Measure): string[]`
  - `fitParagraphs(paragraphs: string[], maxWidth: number, maxLines: number, measure: Measure): string[]` — перенос всех абзацев; при переполнении последняя строка заканчивается `…`
  - `sanitizeText(text: string, supported: Set<number>): string` — символы без глифа → `?` (пробел сохраняется всегда)

- [ ] **Step 1: Написать падающий тест `tests/textwrap.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { fitParagraphs, sanitizeText, wrapText } from '../src/textwrap';

const byLength = (s: string) => s.length;

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('ООО Ромашка', 20, byLength)).toEqual(['ООО Ромашка']);
  });

  it('wraps on word boundaries and collapses whitespace', () => {
    expect(wrapText('aaa bbb   ccc ddd', 7, byLength)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('breaks words longer than the line', () => {
    expect(wrapText('abcdefghij xy', 4, byLength)).toEqual(['abcd', 'efgh', 'ij', 'xy']);
  });

  it('returns no lines for empty text', () => {
    expect(wrapText('   ', 10, byLength)).toEqual([]);
  });
});

describe('fitParagraphs', () => {
  it('wraps every paragraph and keeps all lines when they fit', () => {
    expect(fitParagraphs(['aaa bbb', 'cc'], 3, 5, byLength)).toEqual(['aaa', 'bbb', 'cc']);
  });

  // Review Focus #1
  it('truncates overflow with an ellipsis that still fits the width', () => {
    const lines = fitParagraphs(['aaaa bbbb cccc dddd'], 4, 2, byLength);
    expect(lines).toEqual(['aaaa', 'bbb…']);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(4);
  });

  it('returns nothing when zero lines are available', () => {
    expect(fitParagraphs(['aaa'], 10, 0, byLength)).toEqual([]);
  });
});

describe('sanitizeText', () => {
  // Review Focus #2
  it('replaces characters missing from the font with ?', () => {
    const supported = new Set([...'ООО Рм'].map((c) => c.codePointAt(0)!));
    expect(sanitizeText('ООО Рм😀', supported)).toBe('ООО Рм?');
  });

  it('keeps spaces even if the charset lacks them', () => {
    expect(sanitizeText('a b', new Set(['a'.codePointAt(0)!, 'b'.codePointAt(0)!]))).toBe('a b');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/textwrap.test.ts`
Expected: FAIL — `Failed to resolve import "../src/textwrap"`.

- [ ] **Step 3: Реализовать `src/textwrap.ts`**

```ts
export type Measure = (text: string) => number;

const ELLIPSIS = '…';

export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const ch of word) {
      if (chunk && measure(chunk + ch) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export function fitParagraphs(paragraphs: string[], maxWidth: number, maxLines: number, measure: Measure): string[] {
  if (maxLines <= 0) return [];
  const lines = paragraphs.flatMap((p) => wrapText(p, maxWidth, measure));
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(last + ELLIPSIS) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = last + ELLIPSIS;
  return kept;
}

export function sanitizeText(text: string, supported: Set<number>): string {
  return Array.from(text, (ch) => (ch === ' ' || supported.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npx vitest run tests/textwrap.test.ts`
Expected: PASS (все тесты).

- [ ] **Step 5: Commit**

```bash
git add src/textwrap.ts tests/textwrap.test.ts
git commit -m "feat: add text wrapping, truncation and font sanitizing helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Сборка итогового PDF (`render.ts`)

**Files:**
- Create: `src/render.ts`, `tests/helpers/rasterize.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Shipment` (Task 3); `getTemplate` (Task 2); `LayoutPreset` (Task 4); `layoutPages`, `Size` (Task 4); `fitParagraphs`, `sanitizeText` (Task 5); `Rect` (Task 1).
- Produces:
  - `interface RenderInput { shipments: Shipment[]; preset: LayoutPreset; fontBytes: Uint8Array; date?: Date }`
  - `renderSheet(input: RenderInput): Promise<Uint8Array>` — бросает `Error('Нет отправлений для печати')` на пустом списке, `LayoutError` — если пресет не подходит
  - `cellParagraphs(number: number, s: Shipment): string[]`
  - `formatDate(d: Date): string` → `YYYY-MM-DD`
  - `sheetFileName(d: Date): string` → `otpravleniya-YYYY-MM-DD.pdf`
  - `LINE_HEIGHT = 1.25`, `FRAGMENT_NUMBER_SIZE = 6`

- [ ] **Step 1: Хелпер растеризации `tests/helpers/rasterize.ts`**

Нужен только тестам: рендер страниц итогового PDF в 300 dpi и декодирование штрихкодов (проверено в Node 24: вырезанный фрагмент даёт QR и ITF).

```ts
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readBarcodes } from 'zxing-wasm/reader';

export interface Decoded {
  format: string;
  text: string;
}

export async function decodePages(pdfBytes: Uint8Array, dpi = 300): Promise<Decoded[][]> {
  const doc = await getDocument({ data: pdfBytes.slice(), verbosity: 0 }).promise;
  const result: Decoded[][] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // @napi-rs/canvas совместим с API canvas, которое ждёт pdf.js
      await page.render({ canvasContext: ctx as never, canvas: canvas as never, viewport }).promise;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = await readBarcodes(image as never, { formats: ['QRCode', 'ITF'], maxNumberOfSymbols: 32 });
      result.push(found.filter((r) => r.isValid).map((r) => ({ format: r.format, text: r.text })));
    }
  } finally {
    await doc.destroy();
  }
  return result;
}
```

- [ ] **Step 2: Написать падающий тест `tests/render.test.ts`**

```ts
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractShipment, type Shipment } from '../src/extract';
import { LayoutError } from '../src/layout';
import { getPreset } from '../src/presets';
import { cellParagraphs, renderSheet, sheetFileName } from '../src/render';
import { makeBlank, ROBOTO_PATH } from './fixtures/makeBlank';
import { decodePages } from './helpers/rasterize';
import { realDataAvailable, realFiles } from './helpers/realData';

const fontBytes = new Uint8Array(fs.readFileSync(ROBOTO_PATH));
const landscape = getPreset('a4-landscape-2');

async function syntheticShipment(overrides: Parameters<typeof makeBlank>[0] = {}): Promise<Shipment> {
  const res = await extractShipment('synthetic.pdf', await makeBlank(overrides));
  if (!res.ok) throw new Error(res.error.message);
  return res.shipment;
}

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join('\n'));
  }
  await doc.destroy();
  return pages;
}

function images(doc: PDFDocument): { width: number; height: number; filter: string; contents: Uint8Array }[] {
  const out: { width: number; height: number; filter: string; contents: Uint8Array }[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    out.push({
      width: (obj.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(),
      height: (obj.dict.get(PDFName.of('Height')) as PDFNumber).asNumber(),
      filter: String(obj.dict.get(PDFName.of('Filter'))),
      contents: obj.contents,
    });
  }
  return out;
}

describe('helpers', () => {
  it('sheetFileName uses local date', () => {
    expect(sheetFileName(new Date(2026, 8, 29, 23, 59))).toBe('otpravleniya-2026-09-29.pdf');
  });

  it('cellParagraphs lists number, track, sender and recipient', async () => {
    const s = await syntheticShipment();
    expect(cellParagraphs(3, s)).toEqual([
      '№ 3   12345678901234',
      'От кого: ООО "Тест-Отправитель"',
      'г. Тестовск, ул. Первая, д. 1, 101000',
      'Кому: ИП Проверкин',
      'г. Примерск, пр. Второй, д. 2, 202000',
    ]);
  });
});

describe('renderSheet (synthetic)', () => {
  it('rejects an empty list', async () => {
    await expect(renderSheet({ shipments: [], preset: landscape, fontBytes })).rejects.toThrow('Нет отправлений');
  });

  it('propagates LayoutError for an impossible preset', async () => {
    const s = await syntheticShipment();
    const bad = { ...landscape, columns: 4 };
    await expect(renderSheet({ shipments: [s], preset: bad, fontBytes })).rejects.toBeInstanceOf(LayoutError);
  });

  it('puts 7 shipments on 2 landscape A4 pages with the table text', async () => {
    const s = await syntheticShipment();
    const bytes = await renderSheet({ shipments: Array(7).fill(s), preset: landscape, fontBytes });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(841.89, 1);
    expect(height).toBeCloseTo(595.28, 1);
    const [first, second] = await pdfText(bytes);
    expect(first).toContain('Кому: ИП Проверкин');
    expect(first).toContain('№ 6');
    expect(second).toContain('№ 7');
  });

  it('sets title with date', async () => {
    const s = await syntheticShipment();
    const bytes = await renderSheet({ shipments: [s], preset: landscape, fontBytes, date: new Date(2026, 8, 29) });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Отправления 2026-09-29');
  });

  // Review Focus #1 и #2
  it('handles very long names and glyphs missing from the font', async () => {
    const long = 'Общество с ограниченной ответственностью "Очень Длинное Название 😀" '.repeat(6);
    const base = await syntheticShipment();
    const s: Shipment = { ...base, recipient: { ...base.recipient, name: long } };
    const bytes = await renderSheet({ shipments: [s], preset: landscape, fontBytes });
    const [text] = await pdfText(bytes);
    expect(text).toContain('…');
    expect(text).toContain('?');
    expect(text).not.toContain('😀');
  });

  it('renders a batch of 60 shipments into 10 pages', async () => {
    const s = await syntheticShipment();
    const bytes = await renderSheet({ shipments: Array(60).fill(s), preset: landscape, fontBytes });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(10);
  });
});

describe.skipIf(!realDataAvailable)('renderSheet (real samples) — quality', () => {
  async function realShipments(): Promise<Shipment[]> {
    const out: Shipment[] = [];
    for (const f of realFiles()) {
      const res = await extractShipment(f.name, f.bytes);
      if (!res.ok) throw new Error(`${f.name}: ${res.error.message}`);
      out.push(res.shipment);
    }
    return out;
  }

  it('embeds the original barcode and QR image streams byte-for-byte', async () => {
    const shipments = await realShipments();
    const out = await PDFDocument.load(await renderSheet({ shipments, preset: landscape, fontBytes }));
    const outImages = images(out);
    for (const s of shipments) {
      const src = images(await PDFDocument.load(s.pdfBytes));
      for (const img of src.filter((i) => (i.width === 848 && i.height === 1) || (i.width === 980 && i.height === 350))) {
        const match = outImages.find(
          (o) => o.width === img.width && o.height === img.height && Buffer.from(o.contents).equals(Buffer.from(img.contents)),
        );
        expect(match, `${s.fileName}: image ${img.width}x${img.height} not preserved`).toBeDefined();
        expect(match!.filter).toBe('/FlateDecode');
      }
    }
  });

  it('every fragment decodes at 300 dpi: ITF = track, QR mentions the track', async () => {
    const shipments = await realShipments();
    for (const preset of [getPreset('a4-landscape-2'), getPreset('a4-portrait-1')]) {
      const bytes = await renderSheet({ shipments, preset, fontBytes });
      const decoded = (await decodePages(bytes)).flat();
      const itf = decoded.filter((d) => d.format === 'ITF').map((d) => d.text).sort();
      expect(itf, preset.id).toEqual(shipments.map((s) => s.trackNumber).sort());
      for (const s of shipments) {
        expect(decoded.some((d) => d.format === 'QRCode' && d.text.includes(`Barcode: ${s.trackNumber}`)), preset.id).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npx vitest run tests/render.test.ts`
Expected: FAIL — `Failed to resolve import "../src/render"`.

- [ ] **Step 4: Реализовать `src/render.ts`**

```ts
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFEmbeddedPage, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Shipment } from './extract';
import type { Rect } from './geometry';
import { layoutPages, type Size } from './layout';
import type { LayoutPreset } from './presets';
import { getTemplate } from './template';
import { fitParagraphs, sanitizeText } from './textwrap';

export interface RenderInput {
  shipments: Shipment[];
  preset: LayoutPreset;
  fontBytes: Uint8Array;
  date?: Date;
}

export const LINE_HEIGHT = 1.25;
export const FRAGMENT_NUMBER_SIZE = 6;
const CUT_LINE_COLOR = rgb(0.6, 0.6, 0.6);
const NUMBER_COLOR = rgb(0.35, 0.35, 0.35);

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function sheetFileName(d: Date): string {
  return `otpravleniya-${formatDate(d)}.pdf`;
}

export function cellParagraphs(number: number, s: Shipment): string[] {
  return [
    `№ ${number}   ${s.trackNumber}`,
    `От кого: ${s.sender.name}`,
    `${s.sender.address}, ${s.sender.index}`,
    `Кому: ${s.recipient.name}`,
    `${s.recipient.address}, ${s.recipient.index}`,
  ];
}

function fragmentSize(shipments: Shipment[]): Size {
  return shipments.reduce<Size>(
    (acc, s) => {
      const { crop } = getTemplate(s.templateId);
      return { width: Math.max(acc.width, crop.width), height: Math.max(acc.height, crop.height) };
    },
    { width: 0, height: 0 },
  );
}

/** Фрагмент исходной страницы как Form XObject — исходные потоки картинок, без растеризации. */
async function embedFragment(out: PDFDocument, s: Shipment): Promise<PDFEmbeddedPage> {
  const { crop } = getTemplate(s.templateId);
  const src = await PDFDocument.load(s.pdfBytes);
  const page = src.getPage(0);
  const h = page.getHeight();
  return out.embedPage(page, {
    left: crop.x,
    right: crop.x + crop.width,
    top: h - crop.y,
    bottom: h - crop.y - crop.height,
  });
}

/** Нижняя граница прямоугольника в координатах PDF (начало внизу). */
function pdfBottom(page: PDFPage, r: Rect): number {
  return page.getHeight() - r.y - r.height;
}

function drawCellText(page: PDFPage, font: PDFFont, fontSize: number, r: Rect, paragraphs: string[]): void {
  const lineHeight = fontSize * LINE_HEIGHT;
  const maxLines = Math.floor(r.height / lineHeight);
  const measure = (t: string) => font.widthOfTextAtSize(t, fontSize);
  const lines = fitParagraphs(paragraphs, r.width, maxLines, measure);
  lines.forEach((line, i) => {
    page.drawText(line, { x: r.x, y: page.getHeight() - r.y - fontSize - i * lineHeight, size: fontSize, font });
  });
}

export async function renderSheet({ shipments, preset, fontBytes, date = new Date() }: RenderInput): Promise<Uint8Array> {
  if (shipments.length === 0) throw new Error('Нет отправлений для печати');
  const pages = layoutPages(shipments.length, preset, fragmentSize(shipments));

  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  out.setTitle(`Отправления ${formatDate(date)}`);
  const font = await out.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const clean = (t: string) => sanitizeText(t, supported);
  const fragments = await Promise.all(shipments.map((s) => embedFragment(out, s)));

  for (const layout of pages) {
    const page = out.addPage([layout.width, layout.height]);
    for (const cell of layout.cells) {
      const s = shipments[cell.index];
      const f = cell.fragment;
      page.drawPage(fragments[cell.index], {
        x: f.x,
        y: pdfBottom(page, f),
        xScale: preset.fragmentScale,
        yScale: preset.fragmentScale,
      });
      page.drawRectangle({
        x: f.x,
        y: pdfBottom(page, f),
        width: f.width,
        height: f.height,
        borderColor: CUT_LINE_COLOR,
        borderWidth: 0.5,
        borderDashArray: [3, 3],
      });
      if (preset.printNumberOnFragment) {
        // Левый нижний угол вырезки пуст (штрихкод начинается на 40 pt правее) — вне поля тишины.
        page.drawText(String(cell.index + 1), {
          x: f.x + 2,
          y: pdfBottom(page, f) + 2,
          size: FRAGMENT_NUMBER_SIZE,
          font,
          color: NUMBER_COLOR,
        });
      }
      drawCellText(page, font, preset.fontSize, cell.text, cellParagraphs(cell.index + 1, s).map(clean));
    }
  }
  return out.save();
}
```

- [ ] **Step 5: Запустить — убедиться, что проходит**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS — все тесты; блок «real samples — quality» тоже PASS, если `data/` есть локально. Если декодирование 300 dpi не находит ITF на каком-то пресете — **это блокирующий дефект качества**, не ослаблять тест, а разбираться (проверить `crop`, масштаб, номер на фрагменте).

Run: `npm test && npm run typecheck` → Expected: все тесты PASS, типы без ошибок.

- [ ] **Step 6: Сохранить образец для глазной проверки**

Временно добавить в `tests/render.test.ts` в тест декодирования (блок real samples) сразу после `const bytes = ...` одну строку, **не коммитя её**:
```ts
fs.writeFileSync(`C:/Users/Master/AppData/Local/Temp/claude/sample-${preset.id}.pdf`, bytes);
```
Запустить `npx vitest run tests/render.test.ts`, открыть оба PDF, убедиться глазами: фрагменты чёткие, пунктир реза вокруг них, номер в левом нижнем углу фрагмента, текст не залезает на фрагмент. Затем удалить строку (`git diff tests/render.test.ts` — пусто относительно Step 2).

- [ ] **Step 7: Commit**

```bash
git add src/render.ts tests/render.test.ts tests/helpers/rasterize.ts
git commit -m "feat: render print sheet with lossless fragments and requisites table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Состояние списка файлов (`state.ts`)

**Files:**
- Create: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `ExtractResult`, `Shipment` (Task 3).
- Produces:
  - `type EntryStatus = 'pending' | 'ok' | 'error'`
  - `interface FileEntry { id: string; fileName: string; status: EntryStatus; shipment?: Shipment; error?: string }`
  - `addPending(entries: FileEntry[], files: { id: string; fileName: string }[]): FileEntry[]`
  - `resolveEntry(entries: FileEntry[], id: string, result: ExtractResult): FileEntry[]`
  - `removeEntry(entries: FileEntry[], id: string): FileEntry[]`
  - `moveEntry(entries: FileEntry[], fromId: string, toId: string): FileEntry[]`
  - `duplicateTracks(entries: FileEntry[]): Set<string>`
  - `readyShipments(entries: FileEntry[]): Shipment[]`

Все функции чистые и возвращают новый массив.

- [ ] **Step 1: Написать падающий тест `tests/state.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { ExtractResult, Shipment } from '../src/extract';
import {
  addPending,
  duplicateTracks,
  moveEntry,
  readyShipments,
  removeEntry,
  resolveEntry,
  type FileEntry,
} from '../src/state';

function shipment(track: string): Shipment {
  const party = { name: 'n', address: 'a', index: '000000' };
  return { fileName: `${track}.pdf`, templateId: 't', sender: party, recipient: party, trackNumber: track, pdfBytes: new Uint8Array() };
}
const ok = (track: string): ExtractResult => ({ ok: true, shipment: shipment(track) });
const bad: ExtractResult = { ok: false, fileName: 'x.pdf', error: { code: 'unreadable', message: 'Не удалось прочитать файл' } };

function seed(): FileEntry[] {
  return addPending([], [
    { id: 'a', fileName: 'a.pdf' },
    { id: 'b', fileName: 'b.pdf' },
    { id: 'c', fileName: 'c.pdf' },
  ]);
}

describe('state', () => {
  it('addPending appends entries with pending status', () => {
    const entries = seed();
    expect(entries.map((e) => [e.id, e.status])).toEqual([['a', 'pending'], ['b', 'pending'], ['c', 'pending']]);
    expect(addPending(entries, [{ id: 'd', fileName: 'd.pdf' }]).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('resolveEntry stores shipment or error message', () => {
    let entries = resolveEntry(seed(), 'a', ok('11111111111111'));
    entries = resolveEntry(entries, 'b', bad);
    expect(entries[0]).toMatchObject({ status: 'ok', shipment: { trackNumber: '11111111111111' } });
    expect(entries[1]).toMatchObject({ status: 'error', error: 'Не удалось прочитать файл' });
    expect(entries[2].status).toBe('pending');
  });

  // Review Focus #4
  it('resolveEntry for a removed entry does not bring it back', () => {
    const entries = resolveEntry(removeEntry(seed(), 'b'), 'b', ok('22222222222222'));
    expect(entries.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('moveEntry moves an entry to the position of the target', () => {
    expect(moveEntry(seed(), 'c', 'a').map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(moveEntry(seed(), 'a', 'c').map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(moveEntry(seed(), 'a', 'a').map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(moveEntry(seed(), 'zzz', 'a').map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('duplicateTracks finds tracks used by more than one ok entry', () => {
    let entries = resolveEntry(seed(), 'a', ok('11111111111111'));
    entries = resolveEntry(entries, 'b', ok('11111111111111'));
    entries = resolveEntry(entries, 'c', ok('33333333333333'));
    expect([...duplicateTracks(entries)]).toEqual(['11111111111111']);
  });

  it('readyShipments returns ok shipments in list order', () => {
    let entries = resolveEntry(seed(), 'c', ok('33333333333333'));
    entries = resolveEntry(entries, 'a', ok('11111111111111'));
    entries = resolveEntry(entries, 'b', bad);
    expect(readyShipments(entries).map((s) => s.trackNumber)).toEqual(['11111111111111', '33333333333333']);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `Failed to resolve import "../src/state"`.

- [ ] **Step 3: Реализовать `src/state.ts`**

```ts
import type { ExtractResult, Shipment } from './extract';

export type EntryStatus = 'pending' | 'ok' | 'error';

export interface FileEntry {
  id: string;
  fileName: string;
  status: EntryStatus;
  shipment?: Shipment;
  error?: string;
}

export function addPending(entries: FileEntry[], files: { id: string; fileName: string }[]): FileEntry[] {
  return [...entries, ...files.map((f) => ({ id: f.id, fileName: f.fileName, status: 'pending' as const }))];
}

export function resolveEntry(entries: FileEntry[], id: string, result: ExtractResult): FileEntry[] {
  return entries.map((e) => {
    if (e.id !== id) return e;
    return result.ok
      ? { ...e, status: 'ok' as const, shipment: result.shipment, error: undefined }
      : { ...e, status: 'error' as const, shipment: undefined, error: result.error.message };
  });
}

export function removeEntry(entries: FileEntry[], id: string): FileEntry[] {
  return entries.filter((e) => e.id !== id);
}

export function moveEntry(entries: FileEntry[], fromId: string, toId: string): FileEntry[] {
  const from = entries.findIndex((e) => e.id === fromId);
  const to = entries.findIndex((e) => e.id === toId);
  if (from < 0 || to < 0 || from === to) return entries;
  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function duplicateTracks(entries: FileEntry[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const e of entries) {
    const track = e.status === 'ok' ? e.shipment?.trackNumber : undefined;
    if (!track) continue;
    if (seen.has(track)) dups.add(track);
    seen.add(track);
  }
  return dups;
}

export function readyShipments(entries: FileEntry[]): Shipment[] {
  return entries.flatMap((e) => (e.status === 'ok' && e.shipment ? [e.shipment] : []));
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS (все тесты).

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: add pure file list state operations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Интерфейс (`ui/app.ts`, `main.ts`, стили)

**Files:**
- Create: `src/ui/app.ts`, `src/styles.css`
- Modify: `src/main.ts` (заменить целиком)

**Interfaces:**
- Consumes: `extractShipment` (Task 3); `renderSheet`, `sheetFileName` (Task 6); `PRESETS`, `DEFAULT_PRESET_ID`, `getPreset` (Task 4); все функции `state.ts` (Task 7).
- Produces: `mountApp(root: HTMLElement): void`. Разметка содержит `#version` и `#update-banner` / `#update-btn` — их использует Task 9.

UI тонкий: вся логика в уже протестированных модулях. Пользовательские данные выводятся только через `textContent` (никакого `innerHTML` с именами файлов или адресами).

- [ ] **Step 1: Создать `src/styles.css`**

```css
:root {
  --bg: #f5f6f8;
  --panel: #ffffff;
  --text: #1c1e21;
  --muted: #5f6570;
  --accent: #1f4e8c;
  --ok: #1d7a3a;
  --error: #b3261e;
  --warn: #9a6200;
  --border: #d8dce2;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
}

* { box-sizing: border-box; }
body { margin: 0; }
header, footer { padding: 12px 20px; }
header h1 { margin: 0; font-size: 20px; }
footer { color: var(--muted); font-size: 13px; display: flex; gap: 16px; align-items: center; }

main {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(360px, 1.4fr);
  gap: 16px;
  padding: 0 20px 20px;
}
@media (max-width: 900px) { main { grid-template-columns: 1fr; } }

.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }

.drop {
  border: 2px dashed var(--border);
  border-radius: 10px;
  padding: 28px 16px;
  text-align: center;
  color: var(--muted);
  cursor: pointer;
}
.drop:focus-visible, .drop.is-over { border-color: var(--accent); color: var(--accent); outline: none; }

.file-list { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 6px; }
.file-list li {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 8px;
  align-items: start;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: grab;
}
.file-list li.is-drag-over { border-color: var(--accent); }
.file-list .num { color: var(--muted); }
.file-list .name { font-weight: 600; word-break: break-all; }
.file-list .status { font-size: 13px; color: var(--muted); }
.file-list .status.ok { color: var(--ok); }
.file-list .status.error { color: var(--error); }
.file-list .warn { font-size: 13px; color: var(--warn); }
.file-list button { border: none; background: none; cursor: pointer; font-size: 16px; color: var(--muted); }

.actions { display: flex; gap: 8px; margin: 12px 0; }
.actions button, #update-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
.actions button:disabled { opacity: 0.45; cursor: not-allowed; }
.hint { background: #fff7e0; border: 1px solid #f0d58a; border-radius: 8px; padding: 8px 12px; font-size: 14px; }
#sheet-status { min-height: 1.2em; color: var(--muted); }
#sheet-status.error { color: var(--error); }
#preview { width: 100%; height: 70vh; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
#update-banner { display: flex; gap: 8px; align-items: center; color: var(--text); }
#update-banner[hidden] { display: none; }
```

- [ ] **Step 2: Создать `src/ui/app.ts`**

```ts
import robotoUrl from 'roboto-fontface/fonts/roboto/Roboto-Regular.woff?url';
import { extractShipment } from '../extract';
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

export function mountApp(root: HTMLElement): void {
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
    await Promise.all(
      batch.map(async ({ id, fileName, file }) => {
        const result = await extractShipment(fileName, new Uint8Array(await file.arrayBuffer()));
        entries = resolveEntry(entries, id, result);
        renderList();
      }),
    );
    await rebuildSheet();
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
}
```

- [ ] **Step 3: Заменить `src/main.ts`**

```ts
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import './styles.css';
import { mountApp } from './ui/app';

GlobalWorkerOptions.workerSrc = workerUrl;
mountApp(document.getElementById('app')!);
```

- [ ] **Step 4: Проверить типы и сборку**

Run: `npm run typecheck` → Expected: без ошибок. Если TS не знает модуль `roboto-fontface/...woff?url` — `vite/client` уже объявляет `*?url`; убедиться, что `types` в tsconfig содержит `vite/client`.
Run: `npm test` → Expected: все тесты PASS.
Run: `npm run build` → Expected: `dist/` содержит `index.html`, JS, `pdf.worker.min-*.mjs`, `Roboto-Regular-*.woff`.

- [ ] **Step 5: Ручная проверка в браузере**

Run: `npm run dev`, открыть выведенный URL.
Проверить по списку (результат каждого пункта записать в отчёт по задаче — прошёл/нет):
1. Бросить 3 файла из `data/` → у каждого «✓ трек → получатель», превью показывает 1 альбомный лист с 3 ячейками.
2. Бросить тот же файл повторно → у обоих предупреждение «Такой трек-номер уже есть»; в превью 4 ячейки.
3. Бросить не-PDF (любой .txt/.png) → «✗ Не удалось прочитать файл», остальные не пострадали.
4. Перетащить строку списка → порядок в превью меняется (номера 1..N по новому порядку).
5. Удалить строку ✕ → превью пересобирается; удалить все → кнопки неактивны, превью пустое.
6. Переключить на «A4 книжная, 1 колонка» → превью книжное, 5 ячеек на листе.
7. «Скачать PDF» → файл `otpravleniya-YYYY-MM-DD.pdf`.
8. «Печать» → открывается системный диалог печати с PDF (Chrome/Edge). Если в каком-то браузере не открывается — зафиксировать это в отчёте, а не молча пропустить.

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.ts src/styles.css src/main.ts
git commit -m "feat: add drag-and-drop UI with preview, download and print

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: PWA, офлайн, обновления и версия

**Files:**
- Create: `public/icon.svg`, `src/pwa.ts`, `src/env.d.ts`, `README.md`
- Create (генерируются): `public/favicon.ico`, `public/apple-touch-icon-180x180.png`, `public/pwa-64x64.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`
- Modify: `vite.config.ts` (заменить целиком), `src/main.ts`, `index.html`, `package.json` (скрипт), `tsconfig.json` (`include` уже содержит `src`)
- Test: `tests/pwa-build.test.ts`

**Interfaces:**
- Consumes: `#version`, `#update-banner`, `#update-btn` из разметки Task 8.
- Produces: `setupPwa(banner: HTMLElement, button: HTMLButtonElement): void`; `UPDATE_CHECK_INTERVAL_MS = 3_600_000`; глобальная константа `__APP_VERSION__: string`.

- [ ] **Step 1: Установить плагины**

Run:
```bash
npm i -D vite-plugin-pwa @vite-pwa/assets-generator
```
Expected: установка без ошибок (проверено: vite-plugin-pwa 1.3 поддерживает vite ^8).

- [ ] **Step 2: Иконка и генерация ассетов**

`public/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1f4e8c"/>
  <rect x="96" y="136" width="320" height="240" rx="20" fill="#ffffff"/>
  <path d="M96 156 L256 276 L416 156" fill="none" stroke="#1f4e8c" stroke-width="24" stroke-linejoin="round"/>
  <g fill="#1c1e21">
    <rect x="150" y="300" width="10" height="52"/><rect x="170" y="300" width="20" height="52"/>
    <rect x="200" y="300" width="10" height="52"/><rect x="222" y="300" width="14" height="52"/>
    <rect x="246" y="300" width="8" height="52"/><rect x="264" y="300" width="22" height="52"/>
    <rect x="296" y="300" width="10" height="52"/><rect x="316" y="300" width="16" height="52"/>
    <rect x="342" y="300" width="10" height="52"/>
  </g>
</svg>
```

Добавить в `package.json` → `scripts`:
```json
"generate-pwa-assets": "pwa-assets-generator --preset minimal-2023 public/icon.svg"
```

Run: `npm run generate-pwa-assets`
Expected: в `public/` появились `favicon.ico`, `apple-touch-icon-180x180.png`, `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`.

- [ ] **Step 3: Заменить `vite.config.ts`**

```ts
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Для хостинга в подкаталоге (например, GitHub Pages): BASE_PATH=/repo-name/ npm run build
  base: process.env.BASE_PATH ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Отправления — печать фрагментов',
        short_name: 'Отправления',
        description: 'Собирает PDF-бланки Почты России в лист для печати',
        lang: 'ru',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f5f6f8',
        theme_color: '#1f4e8c',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,woff,woff2,png,svg,ico}'],
        // worker pdf.js весит больше лимита по умолчанию (2 МБ)
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
```

- [ ] **Step 4: Типы, `src/pwa.ts`, подключение**

`src/env.d.ts`:
```ts
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
```

`src/pwa.ts`:
```ts
import { registerSW } from 'virtual:pwa-register';

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Новая версия не активируется молча — только по кнопке, чтобы не потерять загруженную пачку.
 * Проверка обновления: при загрузке страницы (делает сам браузер) и раз в час, пока приложение открыто.
 */
export function setupPwa(banner: HTMLElement, button: HTMLButtonElement): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      banner.hidden = false;
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) void registration.update();
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });
  button.addEventListener('click', () => {
    void updateSW(true);
  });
}
```

`src/main.ts` (заменить целиком):
```ts
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { setupPwa } from './pwa';
import './styles.css';
import { mountApp } from './ui/app';

GlobalWorkerOptions.workerSrc = workerUrl;
const root = document.getElementById('app')!;
mountApp(root);
root.querySelector('#version')!.textContent = `Версия ${__APP_VERSION__}`;
setupPwa(root.querySelector<HTMLElement>('#update-banner')!, root.querySelector<HTMLButtonElement>('#update-btn')!);
```

`index.html` — в `<head>` после `<title>` добавить:
```html
    <link rel="icon" href="favicon.ico" sizes="any" />
    <link rel="icon" href="icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="apple-touch-icon-180x180.png" />
    <meta name="theme-color" content="#1f4e8c" />
```

- [ ] **Step 5: Написать падающий тест сборки `tests/pwa-build.test.ts`**

Проверяет артефакты сборки: манифест, SW и что в precache попали worker pdf.js и шрифт (без них офлайн не работает).

```ts
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const DIST = path.resolve('dist');

describe('PWA build output', () => {
  beforeAll(() => {
    execSync('npx vite build', { stdio: 'pipe' });
  }, 180_000);

  it('emits a web manifest with name and icons', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
    expect(manifest.short_name).toBe('Отправления');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toContain('512x512');
  });

  it('service worker precaches the pdf.js worker, the font and index.html', () => {
    const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
    expect(sw).toMatch(/pdf\.worker\.min[^"']*\.mjs/);
    expect(sw).toMatch(/Roboto-Regular[^"']*\.woff/);
    expect(sw).toContain('index.html');
  });

  it('bakes the package version into the bundle', () => {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version as string;
    const js = fs
      .readdirSync(path.join(DIST, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8'))
      .join('\n');
    expect(js).toContain(version);
  });
});
```

- [ ] **Step 6: Запустить — убедиться, что проходит**

Сначала без Step 3–4 тест падал бы на отсутствии `manifest.webmanifest`; после них:

Run: `npx vitest run tests/pwa-build.test.ts`
Expected: PASS (3 tests). Если падает `precaches the pdf.js worker` — проверить, что worker попал в `dist/assets` с расширением `.mjs` и что `globPatterns` содержит `mjs`.

Run: `npm test && npm run build` → Expected: всё PASS, сборка без ошибок.

- [ ] **Step 7: Ручная проверка офлайна и обновления**

1. `npm run build && npm run preview` → открыть URL в Chrome. DevTools → Application → Service Workers: SW активен; Manifest: без ошибок, есть кнопка установки.
2. DevTools → Network → Offline → перезагрузить → приложение открывается; бросить файл из `data/` → превью собирается (worker и шрифт из кэша).
3. Вернуть Online. Не закрывая вкладку: поменять `version` в `package.json` на `0.1.1`, `npm run build`, перезапустить `npm run preview` на том же порту, перезагрузить вкладку → внизу плашка «Доступна новая версия» → «Обновить» → в футере «Версия 0.1.1». Вернуть `version` на `0.1.0` и пересобрать.
Результаты записать в отчёт по задаче.

- [ ] **Step 8: `README.md`**

```markdown
# Отправления — печать фрагментов

Офлайн-PWA: принимает пачку PDF-бланков Почты России и собирает PDF для печати —
таблица реквизитов (отправитель, получатель, трек) и фрагменты с QR, маркой и штрихкодом
для вырезания. Фрагменты переносятся из исходного PDF без растеризации, поэтому качество
на бумаге ограничено только принтером.

Файлы обрабатываются в браузере и никуда не отправляются.

## Печать

Печатайте **в масштабе 100%** («Фактический размер»), не «По размеру страницы» —
иначе драйвер пересэмплирует штрихкод.

## Разработка

    npm install
    npm run dev        # dev-сервер (service worker в dev не работает)
    npm test           # тесты; тесты на реальных бланках идут, только если есть data/expected.json
    npm run build      # сборка в dist/
    npm run preview    # проверка собранной версии, включая офлайн

Реальные бланки кладите в `data/` — папка в `.gitignore`, в репозиторий не попадает.

## Выпуск обновления

1. Поднять `version` в `package.json`.
2. `npm run build`.
3. Выложить содержимое `dist/` на хостинг (любой статический; для подкаталога —
   `BASE_PATH=/имя-подкаталога/ npm run build`).

Открытые приложения проверяют обновление при запуске и раз в час; пользователь увидит
плашку «Доступна новая версия» и обновится по кнопке. Хостинг не должен кэшировать
`sw.js` надолго (GitHub Pages — 10 минут, это нормально).

## Раскладка

Пресеты — `src/presets.ts`. Число рядов считается автоматически из размера листа,
полей и размера фрагмента. Новый формат бланка — новый объект в `src/template.ts`.
```

- [ ] **Step 9: Commit**

```bash
git add public src/pwa.ts src/env.d.ts src/main.ts vite.config.ts index.html package.json package-lock.json README.md tests/pwa-build.test.ts
git commit -m "feat: make the app an installable offline PWA with update prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (выполнено при написании)

- **Покрытие спеки:** §2 входные данные → Task 2/3; §4.1 шаблон → Task 2; §4.2 extract → Task 3; §4.3 пресеты/раскладка → Task 4; §4.4 render (без растеризации, пунктир, номер, шрифт, метаданные, имя файла) → Task 5/6; §4.5 UI → Task 8; §4.6 PWA/обновления → Task 9; §5 ошибки → Task 3 (файл), Task 6/8 (сборка); §6 тесты → Task 3/4/6, ручная приёмка → Task 8/9 + пользователь.
- **Отклонения от спеки (осознанные):** зоны «отправитель/получатель» разделены на «имя» и «адрес» по линиям бланка — надёжнее для двухстрочных названий; `Shipment.id` убран — идентификатор живёт в `FileEntry.id`; добавлена проверка поворота страницы и замена отсутствующих в шрифте символов.
- **Не покрыто автотестами:** UI (`ui/app.ts`) и поведение SW в браузере — проверяются вручную (Task 8 Step 5, Task 9 Step 7); печать и сканирование на реальном принтере — только пользователь.
