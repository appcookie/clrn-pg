import type { ScreenshotBounds } from './screenshot';

type Node = { res?: string; bounds: ScreenshotBounds; visible?: boolean; enabled?: boolean };
type Point = Readonly<{ x: number; y: number }>;

/** Reuse the close action's existing observations and single tap. Never read the device. */
export async function observeReviewClose(panel: ScreenshotBounds, screen: { width: number; height: number },
  action: (onTap: (point: Point) => void, onObservation: (nodes: Node[]) => void) => Promise<void>,
  write: (body: string) => void = body => console.error('[texas review close input]', body)): Promise<void> {
  const observations: unknown[] = [];
  let tap: { utc: string; point: Point } | undefined;
  let returned = false;
  try {
    await action(point => {
      try { tap = { utc: new Date().toISOString(), point: { ...point } }; } catch { /* diagnostic only */ }
    }, nodes => {
      try {
        observations.push({ utc: new Date().toISOString(), targets: nodes
          .filter(node => ['screen-mask-touch-to-close', 'review-board-description-text'].includes(node.res || ''))
          .map(node => ({ marker: node.res, bounds: { ...node.bounds }, visible: node.visible, enabled: node.enabled })) });
        if (observations.length > 2) observations.shift();
      } catch { /* diagnostic only */ }
    });
    returned = true;
  } finally {
    try { write(JSON.stringify({ panel, screen, observations, tap, returned, completedUtc: new Date().toISOString() })); }
    catch { /* Preserve the exact action result, including when diagnostics fail. */ }
  }
}
