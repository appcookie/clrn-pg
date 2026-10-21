import { expect } from '@playwright/test';
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
