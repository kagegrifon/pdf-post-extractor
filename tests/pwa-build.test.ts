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
