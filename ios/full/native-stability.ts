import { setTimeout as delay } from 'node:timers/promises';

/** Compare two completed native observations, never a fabricated empty seed.
 * Each driver query keeps its own deadline; only real disagreement is retried.
 */
export async function stableNativeObservation<T>(read: () => Promise<T>,
  assertStable: (previous: T, current: T) => void,
  { initial, timeout = 30_000, interval = 250, restartOn }: {
    initial?: T; timeout?: number; interval?: number; restartOn?: (current: T) => boolean;
  } = {}): Promise<T> {
  let previous = initial === undefined ? await read() : initial;
  let deadline = Date.now() + timeout;
  for (;;) {
    await delay(interval);
    const current = await read();
    // 重连等中断恢复后，以新观测重新开始；中断前的布局不能充当连续稳定证据。
    if (restartOn?.(current)) {
      previous = current;
      deadline = Date.now() + timeout;
      continue;
    }
    try {
      assertStable(previous, current);
      return current;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      previous = current;
    }
  }
}
