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
