/** Разбор и сравнение версий SemVer. Чистые функции — без чтения файлов и git. */

/** @typedef {{ major: number, minor: number, patch: number }} Version */

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Разбирает строку `X.Y.Z` в числовые компоненты.
 * Пре-релизы и суффиксы не поддерживаются.
 * @param {string} raw
 * @returns {Version}
 */
export function parseVersion(raw) {
  const match = SEMVER_PATTERN.exec(raw);
  if (!match) {
    throw new Error(`Версия «${raw}» не соответствует формату SemVer X.Y.Z`);
  }

  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/**
 * Сравнивает две версии покомпонентно как числа.
 * @param {string} left
 * @param {string} right
 * @returns {number} > 0 если `left` новее, < 0 если старее, 0 если версии равны
 */
export function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);

  const componentOrder = /** @type {Array<keyof Version>} */ (['major', 'minor', 'patch']);
  for (const component of componentOrder) {
    const difference = leftVersion[component] - rightVersion[component];
    if (difference !== 0) return difference;
  }

  return 0;
}
