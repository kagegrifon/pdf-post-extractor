import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readBarcodes } from 'zxing-wasm/reader';

export interface Decoded {
  format: string;
  text: string;
}

export async function decodePages(pdfBytes: Uint8Array, dpi = 300): Promise<Decoded[][]> {
  const task = getDocument({ data: pdfBytes.slice(), verbosity: 0 });
  const doc = await task.promise;
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
    await task.destroy();
  }
  return result;
}
