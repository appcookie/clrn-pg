import { setTimeout as delay } from 'node:timers/promises';

/** Compare two completed native observations, never a fabricated empty seed.
 * Each driver query keeps its own deadline; only real disagreement is retried.
 */
export async function stableNativeObservation<T>(read: () => Promise<T>,
  assertStable: (previous: T, current: T) => void,
  { initial, timeout = 30_000, interval = 250 }: { initial?: T; timeout?: number; interval?: number } = {}): Promise<T> {
  let previous = initial === undefined ? await read() : initial;
  const deadline = Date.now() + timeout;
  for (;;) {
    await delay(interval);
    const current = await read();
    try {
      assertStable(previous, current);
      return current;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      previous = current;
    }
  }
}
