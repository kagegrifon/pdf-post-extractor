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
