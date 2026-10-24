import { PNG } from 'pngjs';
import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import { texasPlayerAction, texasPlayerActionRegion, texasPlayerActionMotionBounds } from './texas-action-region';
import type { ScreenshotBounds } from './screenshot';

type ActionStart = { region: ScreenshotBounds; timer: ScreenshotBounds };
const intersects = (a: ScreenshotBounds, b: ScreenshotBounds) => a.x < b.x + b.width
  && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Only the acting avatar's real start timer may vary before recording starts.
 * The complete bubble crop remains the evidence; its independent foreground
 * outside the avatar is never excluded. No video/middle/end image is masked.
 */
export function texasActionStart(name: string, before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }, region: ScreenshotBounds): ActionStart {
  const { player } = texasPlayerAction(name, before, after);
  const expected = texasPlayerActionRegion(name, before, after, screen);
  if (Object.keys(expected).some(key => expected[key as keyof ScreenshotBounds] !== region[key as keyof ScreenshotBounds]))
    throw new Error('动作起点比较必须保留完整原生气泡范围');
  const id = player.res!.replace(/-operating$/, '');
  const actors = before.filter(node => node.visible !== false && node.res === `${id}-operating`);
  if (actors.length !== 1) throw new Error('动作起点必须有唯一实际行动玩家');
  const actor = actors[0];
  if (flattenNodes(actor).some(node => node.visible !== false
    && /^texas-holdem-player-action-(call|raise|check|fold)$/.test(node.res || '')))
    throw new Error('起点倒计时排除不得覆盖已有动作标签');
  const timers = playerCountdownNodes([actor], 'texas-holdem');
  if (timers.length !== 1) throw new Error('动作起点必须有唯一实际原生倒计时');
  const timer = timers[0].bounds, p = actor.bounds;
  if (![timer.x, timer.y, timer.width, timer.height].every(Number.isInteger)
    || timer.x < 0 || timer.y < 0 || timer.x + timer.width > screen.width
    || timer.y + timer.height > screen.height || timer.width !== p.width
    || Math.abs(timer.height - timer.width) > 3
    || timer.width * timer.height > screen.width * screen.height * 0.12)
    throw new Error('动作起点倒计时必须保持真实头像范围及全屏12%限制');
  if (intersects(timer, texasPlayerActionMotionBounds(name, before, after)))
    throw new Error('倒计时不得排除头像之外的动作目标');
  return { region, timer };
}

/** Average only the retained pixels; excluded timer pixels cannot dilute a
 * changed foreground. Exact start-baseline comparison still checks every
 * retained channel with the existing 12-level native encoding tolerance.
 */
export function compareTexasActionStart(left: Buffer, right: Buffer, start: ActionStart) {
  const a = PNG.sync.read(left), b = PNG.sync.read(right), { region, timer } = start;
  if (a.width !== b.width || a.height !== b.height || a.width !== region.width || a.height !== region.height)
    throw new Error('动作起点截图必须对应完整原生范围');
  let difference = 0, pixels = 0, exact = true;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const sx = x + region.x, sy = y + region.y;
    if (sx >= timer.x && sx < timer.x + timer.width && sy >= timer.y && sy < timer.y + timer.height) continue;
    pixels++;
    const offset = (y * a.width + x) * 4;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(a.data[offset + channel] - b.data[offset + channel]);
      if (channel < 3) difference += delta;
      if (delta > 12) exact = false;
    }
  }
  if (!pixels) throw new Error('动作起点不得排除全部比较像素');
  return { distance: difference / (pixels * 3), samePixels: exact,
    comparedPixels: pixels, excludedPixels: a.width * a.height - pixels };
}
