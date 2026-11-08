import { PNG } from 'pngjs';
import { maximumChangedPixelRatio } from '../visual.mjs';
import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import { texasPlayerAction, texasPlayerActionRegion, texasPlayerActionMotionBounds } from './texas-action-region';
import type { ScreenshotBounds } from './screenshot';
import { overlaps, sameBounds, withinScreen, pointInside, type Screen } from './texas-animation-geometry';

type ActionStart = { region: ScreenshotBounds; timer: ScreenshotBounds };
/** Only the acting avatar's real start timer may vary before recording starts.
 * The complete bubble crop remains the evidence; its independent foreground
 * outside the avatar is never excluded. No video/middle/end image is masked.
 */
export function texasActionStart(name: string, before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }, region: ScreenshotBounds): ActionStart {
  const { player } = texasPlayerAction(name, before, after);
  const expected = texasPlayerActionRegion(name, before, after, screen);
  if (!sameBounds(expected, region))
    throw new Error('动作起点比较必须保留完整原生气泡范围');
  const id = player.res!.replace(/-operating$/, '');
  const actor = startingActor(before, id);
  const timer = actionTimer(actor, screen);
  if (overlaps(timer, texasPlayerActionMotionBounds(name, before, after)))
    throw new Error('倒计时不得排除头像之外的动作目标');
  return { region, timer };
}

function actionTimer(actor: NativeNode, screen: Screen) {
  if (flattenNodes(actor).some(node => node.visible !== false
    && /^texas-holdem-player-action-(call|raise|check|fold)$/.test(node.res || '')))
    throw new Error('起点倒计时排除不得覆盖已有动作标签');
  const timers = playerCountdownNodes([actor], 'texas-holdem');
  if (timers.length !== 1) throw new Error('动作起点必须有唯一实际原生倒计时');
  validateTimer(timers[0].bounds, actor.bounds, screen);
  return timers[0].bounds;
}
function validateTimer(timer: ScreenshotBounds, player: ScreenshotBounds, screen: Screen) {
  const geometry = [timer.x, timer.y, timer.width, timer.height];
  const avatar = [timer.width === player.width, Math.abs(timer.height - timer.width) <= 3,
    timer.width * timer.height <= screen.width * screen.height * 0.12];
  if (![geometry.every(Number.isInteger), withinScreen(timer, screen), avatar.every(Boolean)].every(Boolean))
    throw new Error('动作起点倒计时必须保持真实头像范围及全屏12%限制');
}

function pixelDifference(a: PNG, b: PNG, offset: number) {
  const deltas = Array.from({ length: 4 }, (_, channel) => Math.abs(a.data[offset + channel] - b.data[offset + channel]));
  return { difference: deltas.slice(0, 3).reduce((sum, delta) => sum + delta, 0),
    changed: deltas.some(delta => delta > 12) };
}
function retainedPixels(a: PNG, b: PNG, { region, timer }: ActionStart) {
  let difference = 0, pixels = 0, changedPixels = 0;
  for (let index = 0; index < a.width * a.height; index++) {
    const x = index % a.width + region.x, y = Math.floor(index / a.width) + region.y;
    if (pointInside(timer, x, y)) continue;
    const pixel = pixelDifference(a, b, index * 4);
    pixels++;
    difference += pixel.difference;
    changedPixels += Number(pixel.changed);
  }
  return { difference, pixels, changedPixels };
}

/** 起点距离与差异比例都只计算保留像素，倒计时排除不能稀释前景变化。 */
export function compareTexasActionStart(left: Buffer, right: Buffer, start: ActionStart) {
  const a = PNG.sync.read(left), b = PNG.sync.read(right), { region } = start;
  if (![a.width === b.width, a.height === b.height, a.width === region.width, a.height === region.height].every(Boolean))
    throw new Error('动作起点截图必须对应完整原生范围');
  const { difference, pixels, changedPixels } = retainedPixels(a, b, start);
  if (!pixels) throw new Error('动作起点不得排除全部比较像素');
  return { distance: difference / (pixels * 3), samePixels: changedPixels / pixels <= maximumChangedPixelRatio,
    comparedPixels: pixels, excludedPixels: a.width * a.height - pixels };
}

function startingActor(before: NativeNode[], id: string) {
  const actors = before.filter(node => node.visible !== false && node.res === `${id}-operating`);
  if (actors.length !== 1) throw new Error('动作起点必须有唯一实际行动玩家');
  return actors[0];
}
