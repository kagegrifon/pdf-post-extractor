import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }));
const { versionLabel } = await import('../src/pwa');

describe('versionLabel', () => {
  it('shows the commit when the build knows it', () => {
    expect(versionLabel('0.2.0', '1c617af')).toBe('Версия 0.2.0 (1c617af)');
    expect(versionLabel('0.2.0', '')).toBe('Версия 0.2.0');
  });
});
