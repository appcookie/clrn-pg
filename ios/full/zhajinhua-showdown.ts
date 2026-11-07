import { PNG } from 'pngjs';
import { maximumChangedPixelRatio } from '../visual.mjs';
import { setImmediate } from 'node:timers/promises';
import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import type { ScreenshotBounds } from './screenshot';

import { inside, onScreen, paddedRegion, horizontallyInside, horizontallySpread, type Screen } from './zhajinhua-region-geometry';

const shown = (node: NativeNode) => node.visible !== false;
function one(nodes: NativeNode[], description: string) {
  if (nodes.length !== 1) throw new Error(`摊牌必须有唯一${description}`);
  return nodes[0];
}
export type ShowdownLayout = {
  region: ScreenshotBounds; timer: ScreenshotBounds; cards: ScreenshotBounds[]; label: ScreenshotBounds;
};

/** The three native sprite wrappers are siblings of the AX cards marker.
 * Their sprite metadata is AX-hidden under the visible card cover. Require
 * the actual visible wrappers/covers; never rewrite that metadata visibility.
 */
export function zhajinhuaShowdownLayout(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ShowdownLayout {
  const actor = one(before.filter(node => shown(node)
    && /^zhajinhua-player-container-.+-operating$/.test(node.res || '')), '起点行动玩家');
  const id = actor.res!.replace(/-operating$/, '');
  const target = one(after.filter(node => shown(node) && (node.res === id || node.res === `${id}-operating`)), '同一终点玩家');
  if (flattenNodes(actor).some(node => shown(node) && node.res === 'player_cards_container'))
    throw new Error('摊牌起点不得已经出现目标三牌');
  const container = one(flattenNodes(target).filter(node => shown(node) && node.res === 'player_cards_container'), '完整三牌容器');
  const wrappers = visibleWrappers(target);
  const cards = wrappers.map(wrapperCard).sort((a, b) => a.x - b.x);
  if (!horizontallySpread(cards)) throw new Error('三牌必须具有原生等间距水平展开的完整终点');
  const label = cardLabel(target, cards[0]);
  const timer = one(playerCountdownNodes([actor], 'zhajinhua'), '真实起点倒计时').bounds;
  const all = [container.bounds,...wrappers.map(node=>node.bounds),label.bounds,timer];
  assertLayoutBounds(all, screen);
  assertTimerSize(timer, screen);
  return { region: paddedRegion(all, screen), timer, cards, label: label.bounds };
}

function visibleWrappers(target: NativeNode): NativeNode[] {
  const wrappers = (target.children || []).filter(shown)
    .filter(node => !node.res && node.enabled !== false)
    .filter(node => (node.children || []).some(child => child.res === 'sprite-image-content'));
  if (wrappers.length !== 3) throw new Error('摊牌终点必须有三个实际牌面包装节点');
  return wrappers;
}

function wrapperCard(wrapper: NativeNode): ScreenshotBounds {
  const children = wrapper.children || [];
  const content = one(children.filter(node => node.res === 'sprite-image-content'), '牌面内容');
  const backing = one(children.filter(node => node.res === 'sprite-image-container'), '牌面范围');
  one(children.filter(node => node.res === 'sprite-image-clipper'), '牌面裁切节点');
  const cover = one(children.filter(shown).filter(node => !node.res && !(node.children || []).length), '实际可见牌面覆盖层');
  assertCardCover(content.bounds, backing.bounds, cover.bounds, wrapper.bounds);
  return content.bounds;
}

function assertCardCover(content: ScreenshotBounds, backing: ScreenshotBounds, cover: ScreenshotBounds,
  wrapper: ScreenshotBounds): void {
  if (!inside(content, wrapper) || ![backing, cover].every(bounds => JSON.stringify(bounds) === JSON.stringify(content)))
    throw new Error('摊牌可见覆盖层必须对应完整原生牌面');
}

function cardLabel(target: NativeNode, first: ScreenshotBounds): NativeNode {
  return one((target.children || []).filter(shown).filter(node => !!node.text && node.res === node.text)
    .filter(node => node.bounds.y >= first.y + first.height && node.bounds.height <= target.bounds.height / 3)
    .filter(node => horizontallyInside(node.bounds, target.bounds)), '完整牌型标签');
}

function assertLayoutBounds(bounds: ScreenshotBounds[], screen: Screen): void {
  if (bounds.some(b => !integerBounds(b) || !onScreen(b, screen)))
    throw new Error('三牌、牌型及倒计时必须完整位于屏幕内');
}

function integerBounds(b: ScreenshotBounds): boolean {
  return [b.x, b.y, b.width, b.height].every(Number.isInteger);
}

/** 起点距离与差异比例只计算倒计时之外的保留像素，终点仍保留完整牌面和牌型。 */
export function compareShowdownStart(left: Buffer, right: Buffer, layout: ShowdownLayout) {
  const a = PNG.sync.read(left), b = PNG.sync.read(right);
  assertStartSize([a, b], layout.region);
  const totals = { difference: 0, pixels: 0, changedPixels: 0 };
  for (let y = 0; y < a.height; y++) compareRow(a, b, y, layout, totals);
  if (!totals.pixels) throw new Error('摊牌起点不得排除全部像素');
  return { distance: totals.difference / (totals.pixels * 3),
    samePixels: totals.changedPixels / totals.pixels <= maximumChangedPixelRatio,
    comparedPixels: totals.pixels, excludedPixels: a.width * a.height - totals.pixels };
}

type Pixels = ReturnType<typeof PNG.sync.read>;
const sameSize = (image: Pixels, region: ScreenshotBounds) => image.width === region.width && image.height === region.height;
const pointInside = (x: number, y: number, b: ScreenshotBounds) =>
  [[x, b.x, b.x + b.width], [y, b.y, b.y + b.height]].every(([value, low, high]) => value >= low && value < high);

function compareRow(a: Pixels, b: Pixels, y: number, layout: ShowdownLayout,
  totals: { difference: number; pixels: number; changedPixels: number }): void {
  for (let x = 0; x < a.width; x++) {
    if (pointInside(x + layout.region.x, y + layout.region.y, layout.timer)) continue;
    const offset = (y * a.width + x) * 4;
    totals.pixels++;
    totals.difference += rgbDifference(a, b, offset, offset);
    totals.changedPixels += Number([0, 1, 2, 3].some(channel => Math.abs(a.data[offset + channel] - b.data[offset + channel]) > 12));
  }
}

function rgbDifference(a: Pixels, b: Pixels, offsetA: number, offsetB: number): number {
  let difference = 0;
  for (let channel = 0; channel < 3; channel++) difference += Math.abs(a.data[offsetA + channel] - b.data[offsetB + channel]);
  return difference;
}

function patchDistance(frame: Pixels, reference: Pixels, patch: ScreenshotBounds, x: number): number {
  let difference = 0;
  for (let row = 0; row < patch.height; row++) for (let column = 0; column < patch.width; column++) {
    const a = ((patch.y + row) * frame.width + x + column) * 4;
    const b = ((patch.y + row) * reference.width + patch.x + column) * 4;
    difference += rgbDifference(frame, reference, a, b);
  }
  return difference / (patch.width * patch.height * 3);
}

async function decodeFrames(frames: Buffer[], indices: number[]): Promise<Map<number, Pixels>> {
  const decoded = new Map<number, Pixels>();
  for (const index of indices) {
    decoded.set(index, PNG.sync.read(frames[index]));
    await setImmediate();
  }
  return decoded;
}

function assertMotionSize(images: Pixels[], region: ScreenshotBounds): void {
  if (images.some(image => !sameSize(image, region))) throw new Error('三牌运动必须使用完整原生范围');
}

function cardPatches(layout: ShowdownLayout): ScreenshotBounds[] {
  return layout.cards.map(card => ({ x: card.x - layout.region.x + Math.floor(card.width * .1),
    y: card.y - layout.region.y + Math.floor(card.height * .08),
    width: Math.floor(card.width * .35), height: Math.floor(card.height * .8) }));
}

function channelContrast(image: Pixels, patch: ScreenshotBounds, channel: number): number {
  let low = 255, high = 0;
  for (let row = 0; row < patch.height; row++) for (let column = 0; column < patch.width; column++) {
    const value = image.data[((patch.y + row) * image.width + patch.x + column) * 4 + channel];
    low = Math.min(low, value); high = Math.max(high, value);
  }
  return high - low;
}

function requireContrast(end: Pixels, patch: ScreenshotBounds): void {
  const contrast = Math.max(...[0, 1, 2].map(channel => channelContrast(end, patch, channel)));
  if (contrast < 40) throw new Error('每张牌必须有实际可识别牌面，空白色块不能代替');
}

function requirePatchEndpoints(start: Pixels, end: Pixels, last: Pixels, patch: ScreenshotBounds): void {
  requireContrast(end, patch);
  if (patchDistance(start, end, patch, patch.x) <= 10) throw new Error('起点不得已含摊牌牌面');
  if (patchDistance(last, end, patch, patch.x) >= 10) throw new Error('原片终点必须有完整的每张牌面');
}

function bestPatch(frame: Pixels, end: Pixels, patch: ScreenshotBounds, travel: number, endpointDistance: number) {
  let best = { x: patch.x, distance: endpointDistance };
  const lower = Math.ceil(patch.x - travel * .65), upper = Math.floor(patch.x - Math.max(4, travel * .1));
  for (let x = lower; x <= upper; x++) {
    const distance = patchDistance(frame, end, patch, x);
    if (distance < best.distance) best = { x, distance };
  }
  return best;
}

const translatedCard = (best: { x: number; distance: number }, patch: ScreenshotBounds, endpointDistance: number) =>
  best.x !== patch.x && best.distance < 10 && endpointDistance - best.distance > 3;

async function cardCandidates(decoded: Map<number, Pixels>, end: Pixels, patch: ScreenshotBounds, travel: number) {
  const candidates: { index: number; x: number; distance: number; endpointDistance: number }[] = [];
  for (const [index, frame] of decoded) {
    const endpointDistance = patchDistance(frame, end, patch, patch.x);
    const best = bestPatch(frame, end, patch, travel, endpointDistance);
    if (translatedCard(best, patch, endpointDistance)) candidates.push({ index, ...best, endpointDistance });
    await setImmediate();
  }
  return candidates;
}

/** Track each different rank/suit patch horizontally against its own endpoint.
 * A fade, changed sprite sizing, or another card crossing this slot cannot
 * supply this card's translated identity. The first card itself has no
 * horizontal animation in Player._renderCards; require its appearance only.
 */
export async function showdownHorizontalEvidence(before: Buffer, after: Buffer, frames: Buffer[],
  indices: number[], layout: ShowdownLayout) {
  const start = PNG.sync.read(before), end = PNG.sync.read(after);
  const decoded = await decodeFrames(frames, indices), last = PNG.sync.read(frames.at(-1)!);
  assertMotionSize([start, end, last, ...decoded.values()], layout.region);
  const patches = cardPatches(layout);
  for (const patch of patches) requirePatchEndpoints(start, end, last, patch);
  const cards: { card: number; patch: ScreenshotBounds; travel: number;
    candidates: Awaited<ReturnType<typeof cardCandidates>> }[] = [];
  for (const [index, patch] of patches.slice(1).entries()) {
    const travel = layout.cards[index + 1].x - layout.cards[0].x;
    cards.push({ card: index + 2, patch, travel, candidates: await cardCandidates(decoded, end, patch, travel) });
  }
  const shared = indices.filter(index => cards.every(card => card.candidates.some(candidate => candidate.index === index)));
  return { cards, middleIndices: shared };
}

function assertTimerSize(timer: ScreenshotBounds, screen: Screen): void {
  if (timer.width * timer.height > screen.width * screen.height * .12) throw new Error('起点倒计时超过全屏12%限制');
}

function assertStartSize(images: Pixels[], region: ScreenshotBounds): void {
  if (!images.every(image => sameSize(image, region))) throw new Error('摊牌起点必须对应完整原生范围');
}
