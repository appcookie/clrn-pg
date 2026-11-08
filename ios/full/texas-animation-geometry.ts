import type { ScreenshotBounds } from './screenshot';

export type Screen = { width: number; height: number };

export function positiveSize(bounds: ScreenshotBounds) {
  return bounds.width > 0 && bounds.height > 0;
}

export function inside(a: ScreenshotBounds, b: ScreenshotBounds) {
  return [b.x >= a.x, b.y >= a.y, b.x + b.width <= a.x + a.width,
    b.y + b.height <= a.y + a.height].every(Boolean);
}

export function contains(a: ScreenshotBounds, b: ScreenshotBounds) {
  return positiveSize(b) && inside(a, b);
}

export function withinScreen(bounds: ScreenshotBounds, screen: Screen) {
  return inside({ x: 0, y: 0, ...screen }, bounds);
}

export function sameBounds(a: ScreenshotBounds, b: ScreenshotBounds) {
  return (['x', 'y', 'width', 'height'] as const).every(key => a[key] === b[key]);
}

export function overlaps(a: ScreenshotBounds, b: ScreenshotBounds) {
  const horizontal = a.x < b.x + b.width && b.x < a.x + a.width;
  const vertical = a.y < b.y + b.height && b.y < a.y + a.height;
  return [horizontal, vertical].every(Boolean);
}

export function paddedRegion(bounds: ScreenshotBounds[], screen: Screen, padding: number): ScreenshotBounds {
  const x = Math.max(0, Math.min(...bounds.map(b => b.x)) - padding);
  const y = Math.max(0, Math.min(...bounds.map(b => b.y)) - padding);
  return { x, y, width: Math.min(screen.width, Math.max(...bounds.map(b => b.x + b.width)) + padding) - x,
    height: Math.min(screen.height, Math.max(...bounds.map(b => b.y + b.height)) + padding) - y };
}

export function pointInside(bounds: ScreenshotBounds, x: number, y: number) {
  const horizontal = x >= bounds.x && x < bounds.x + bounds.width;
  const vertical = y >= bounds.y && y < bounds.y + bounds.height;
  return [horizontal, vertical].every(Boolean);
}
