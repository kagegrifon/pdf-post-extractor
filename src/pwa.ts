import { registerSW } from 'virtual:pwa-register';

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function versionLabel(version: string, commit: string): string {
  return commit ? `Версия ${version} (${commit})` : `Версия ${version}`;
}

/**
 * Новая версия скачивается в фоне и ждёт активации. Если в приложении ничего не загружено — включаем её сразу
 * (перезагрузка ничего не теряет), иначе показываем плашку, чтобы не потерять загруженную пачку.
 * Без активации обычная перезагрузка вкладки продолжает отдавать старую версию из кэша service worker.
 * Проверка обновления: при загрузке страницы, при возврате к вкладке и раз в час, пока приложение открыто.
 */
export function setupPwa(banner: HTMLElement, button: HTMLButtonElement, hasUnsavedWork: () => boolean): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      if (hasUnsavedWork()) banner.hidden = false;
      else void updateSW(true);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update();
      };
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
  button.addEventListener('click', () => {
    void updateSW(true);
  });
}
