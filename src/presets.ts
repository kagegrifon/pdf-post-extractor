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
