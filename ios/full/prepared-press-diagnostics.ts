import type { Bounds } from './native-device';

/** Observe the existing single tap without adding queries during animation. */
export function observePreparedPress(label: string,
  bounds: Bounds, screen: { width: number; height: number }, press: () => Promise<void>,
  write: (body: string) => void = body => console.log(`[${label} input]`, body)): () => Promise<void> {
  const preparedUtc = new Date().toISOString();
  const geometry = { bounds: { ...bounds }, screen: { ...screen },
    preparedCenter: { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) } };
  return async () => {
    const requestedUtc = new Date().toISOString();
    let returned = false;
    try {
      await press();
      returned = true;
    } finally {
      // Diagnostic failures must neither replace an input error nor fail a successful tap.
      try {
        write(JSON.stringify({ preparedUtc, requestedUtc, completedUtc: new Date().toISOString(),
          returned, ...geometry }));
      } catch {}
    }
  };
}
