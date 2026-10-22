import { expect } from '@playwright/test';
import { assertVisual } from './device';
import { comparePixels } from '../visual.mjs';
import { subtractPanel } from './game-masks';
import { maskScreenshot, type ScreenshotBounds } from './screenshot';
import { recognizeRecordedText, type RecordedText } from './recorded-text';
import { toastKeyframes } from './toast-keyframes';
import { recordNativeVideoFrames } from './video-frames';
import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import type { ScreenshotMask } from './screenshot';
import type { TexasContext } from './texas-support';
import { gameSession } from './game-room';
import { events } from '../../visual/cases/texas-holdem/replayData';

/** A failed acknowledgement must not replay this three-second result again. */
export async function triggerPredictionResult(context: Pick<TexasContext, 'proxy' | 'room'>): Promise<string> {
  expect((await gameSession(context.proxy)).room?.roomId,
    '猜牌回放只能发送到本轮新建的私人房').toBe(context.room);
  await context.proxy.command('texas/replay', { roomId: context.room,
    data: events([{ event: 'settlement_hand_prediction', result: { net: 10, currency_name: 'coin' } }]) });
  return '+10';
}

/** Validate the one real, short-lived winning amount around each screenshot. */
export async function requirePredictionResult(device: Pick<NativeDevice, 'transientMarker'>,
  masks: ScreenshotMask[]) {
  const amount = await device.transientMarker('bet-next-hand-result-amount');
  expect(amount?.text, '猜牌结果必须在截图前后可见且准确为 +10').toBe('+10');
  const bounds = amount!.bounds;
  expect(masks.some(mask => mask.x < bounds.x + bounds.width && mask.x + mask.width > bounds.x
    && mask.y < bounds.y + bounds.height && mask.y + mask.height > bounds.y),
  '猜牌中奖金额不能被背景动态遮罩覆盖').toBe(false);
  return { utc: new Date().toISOString(), ...amount! };
}

const winningText: Record<string, RegExp> = {
  en: /congratulations/i, 'zh-Hans': /恭喜/, 'zh-Hant': /恭喜/,
};

function predictionLines(lines: RecordedText[], locale: string, screen: { width: number; height: number }) {
  if (lines.some(line => /connecting|connection\s*timeout/i.test(line.text))) return [];
  const central = lines.filter(line => {
    const x = (line.bounds.x + line.bounds.width / 2) * screen.width;
    const y = (line.bounds.y + line.bounds.height / 2) * screen.height;
    return line.confidence >= 0.3 && x > screen.width * 0.1 && x < screen.width * 0.9
      && y > screen.height * 0.35 && y < screen.height * 0.65;
  });
  const amount = central.find(line => line.text.normalize('NFKC').replace(/\s+/g, '') === '+10');
  const title = central.find(line => winningText[locale]?.test(line.text));
  if (!amount || !title) return [];
  const xDistance = Math.abs((amount.bounds.x + amount.bounds.width / 2)
    - (title.bounds.x + title.bounds.width / 2));
  const yDistance = Math.abs((amount.bounds.y + amount.bounds.height / 2)
    - (title.bounds.y + title.bounds.height / 2));
  return xDistance < 0.25 && yDistance < 0.12 ? [title, amount] : [];
}

function predictionPanel(lines: RecordedText[], screen: { width: number; height: number }): ScreenshotBounds {
  const left = Math.min(...lines.map(line => line.bounds.x * screen.width));
  const top = Math.min(...lines.map(line => line.bounds.y * screen.height));
  const right = Math.max(...lines.map(line => (line.bounds.x + line.bounds.width) * screen.width));
  const bottom = Math.max(...lines.map(line => (line.bounds.y + line.bounds.height) * screen.height));
  const padding = Math.ceil(screen.width * 0.03);
  const x = Math.max(0, Math.floor(left) - padding), y = Math.max(0, Math.floor(top) - padding);
  return { x, y, width: Math.min(screen.width, Math.ceil(right) + padding) - x,
    height: Math.min(screen.height, Math.ceil(bottom) + padding) - y };
}

/** The native result lasts three seconds; retain one real recording before
 * sending its one event, then validate the visible amount in the recorded PNGs.
 * A slow XCTest accessibility query cannot observe this transient reliably.
 */
export async function capturePredictionResult(device: NativeDevice, name: string, testInfo: TestInfo,
  backgroundMasks: ScreenshotMask[], trigger: () => Promise<string | void>,
  record = recordNativeVideoFrames, recognize = recognizeRecordedText): Promise<void> {
  const locale = /^(en|zh-Hans|zh-Hant)-/.exec(name)?.[1];
  if (!locale) throw new Error('猜牌结果缺少已知语言');
  let expectedText: string | void = undefined;
  const frames = await record(device, name, { x: 0, y: 0, ...device.screenSize }, async () => {
    expectedText = await trigger();
  }, testInfo, 3500, 10, undefined, 'xctest');
  expect(expectedText, '猜牌中奖夹具必须明确要求真实 +10').toBe('+10');
  const recognized = await recognize(frames);
  expect(recognized).toHaveLength(frames.length);
  const visible = recognized.flatMap((lines, index) => predictionLines(lines, locale, device.screenSize).length
    ? [index] : []);
  expect(visible.length, '同次原生录像必须拍到带 +10 的中奖结果和文案').toBeGreaterThanOrEqual(3);
  expect(visible[0], '中奖结果不能在动作前已经显示').toBeGreaterThan(0);
  expect(visible.at(-1), '中奖结果必须在原片结束前消失').toBeLessThan(frames.length - 1);
  const panel = predictionPanel(predictionLines(recognized[visible[0]], locale, device.screenSize), device.screenSize);
  const masks = backgroundMasks.flatMap(mask => subtractPanel(mask, panel));
  const indices = await toastKeyframes(frames, panel, masks, visible);
  const observations = indices.map(index => ({ index, timestampMs: frames.timestampsMs?.[index],
    lines: predictionLines(recognized[index], locale, device.screenSize) }));
  expect(observations.every(item => item.lines.length === 2), '三张关键帧都必须实际显示 +10 和中奖文案').toBe(true);
  await testInfo.attach(`${name}-result-observation`, { body: JSON.stringify({ panel, observations }),
    contentType: 'application/json' });
  const keyframes = [];
  for (const [order, index] of indices.entries()) {
    const attachment = `${name}-verified-keyframe-${order + 1}`;
    await testInfo.attach(attachment, { body: frames[index], contentType: 'image/png' });
    keyframes.push({ attachment, timestampMs: frames.timestampsMs![index],
      frameIndex: frames.sourceFrameIndices?.[index] ?? index });
  }
  await testInfo.attach(`${name}-video-keyframes`, { body: JSON.stringify(keyframes), contentType: 'application/json' });
  await testInfo.attach(`${name}-masks`, { body: JSON.stringify(masks), contentType: 'application/json' });
  const representative = maskScreenshot(frames[indices[1]], masks);
  for (const index of indices) expect(comparePixels(maskScreenshot(frames[index], masks), representative).matches).toBe(true);
  await assertVisual(representative, `${name}.png`, testInfo);
}
