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
