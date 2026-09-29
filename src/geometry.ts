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
