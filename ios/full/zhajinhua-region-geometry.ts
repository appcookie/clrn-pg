// Shared geometry for the zhajinhua animation assertions; subject to the same test budget.
import type { ScreenshotBounds } from './screenshot';

export type Screen = { width: number; height: number };

export const positiveSize = (b: ScreenshotBounds) => b.width > 0 && b.height > 0;
export const horizontallyInside = (b: ScreenshotBounds, outer: ScreenshotBounds) =>
  b.x >= outer.x && b.x + b.width <= outer.x + outer.width;
const verticallyInside = (b: ScreenshotBounds, outer: ScreenshotBounds) =>
  b.y >= outer.y && b.y + b.height <= outer.y + outer.height;
export const inside = (b: ScreenshotBounds, outer: ScreenshotBounds) =>
  horizontallyInside(b, outer) && verticallyInside(b, outer);
export const contains = (outer: ScreenshotBounds, b: ScreenshotBounds) => positiveSize(b) && inside(b, outer);
export const screenBounds = (screen: Screen): ScreenshotBounds => ({ x: 0, y: 0, ...screen });
export const onScreen = (b: ScreenshotBounds, screen: Screen) => contains(screenBounds(screen), b);

const intervalsOverlap = ([a, endA, b, endB]: number[]) => a < endB && b < endA;
export const overlaps = (a: ScreenshotBounds, b: ScreenshotBounds) => [
  [a.x, a.x + a.width, b.x, b.x + b.width],
  [a.y, a.y + a.height, b.y, b.y + b.height],
].every(intervalsOverlap);

export function paddedRegion(bounds: ScreenshotBounds[], screen: Screen): ScreenshotBounds {
  const x = Math.max(0, Math.min(...bounds.map(b => b.x)) - 4);
  const y = Math.max(0, Math.min(...bounds.map(b => b.y)) - 4);
  const right = Math.min(screen.width, Math.max(...bounds.map(b => b.x + b.width)) + 4);
  const bottom = Math.min(screen.height, Math.max(...bounds.map(b => b.y + b.height)) + 4);
  return { x, y, width: right - x, height: bottom - y };
}

const withinTolerance = ([actual, expected, tolerance]: number[]) => Math.abs(actual - expected) <= tolerance;
const sameCardShape = (card: ScreenshotBounds, first: ScreenshotBounds) => [
  [card.y, first.y, 2], [card.width, first.width, 6], [card.height, first.height, 2],
].every(withinTolerance);
const validGap = (gap: number, width: number) => gap >= width * .6 && gap <= width * .85;
export function horizontallySpread(cards: ScreenshotBounds[]): boolean {
  return cards.every(card => sameCardShape(card, cards[0]))
    && cards.slice(1).every((card, i) => validGap(card.x - cards[i].x, cards[0].width));
}
