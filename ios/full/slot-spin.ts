import { setTimeout as delay } from 'node:timers/promises';
import type { NativeDevice } from './native-device';
import { gameTapCurrent } from './game-controls';

/** 录屏预热后重新定位旋转按钮，单次点击并确认真实请求到达代理。 */
export async function pressVerifiedSlotSpin(device: NativeDevice, readSpins: () => Promise<number>,
  previousSpins: number, timeoutMs = 10_000): Promise<void> {
  if (!Number.isInteger(previousSpins) || previousSpins < 0 || await readSpins() !== previousSpins) {
    throw new Error('旋转前代理请求计数与预期不符，停止点击');
  }
  await gameTapCurrent(device, 'spin-button');
  const deadline = Date.now() + timeoutMs;
  do {
    const spins = await readSpins();
    if (spins === previousSpins + 1) return;
    if (spins !== previousSpins) throw new Error('旋转请求计数异常，禁止补点');
    if (Date.now() >= deadline) break;
    await delay(250);
  } while (true);
  throw new Error('点击后代理未收到旋转请求，禁止重复点击');
}
