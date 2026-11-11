type Node = { res?: string; text?: string; visible?: boolean };

/** Reuse the original poll samples; never query the device or export node text. */
export async function observeStatisticsReady<T>(target: string, expected: string | undefined,
  assertion: (observe: (nodes: Node[], started: number) => void) => Promise<T>,
  write: (body: string) => void = body => console.error('[statistics readiness]', body)): Promise<T> {
  const samples: unknown[] = [];
  const observe = (nodes: Node[], started: number) => {
    if (target !== 'PlayerStatisticComponent_Item_Value_0') return;
    try {
      if (samples.length === 16) samples.shift();
      samples.push({ utc: new Date().toISOString(), queryMs: Date.now() - started,
        timeout: nodes.some(node => node.visible !== false && /Connection Timeout/i.test(node.text || '')),
        connecting: nodes.some(node => /Connecting\.\.\./.test(node.text || '')),
        targetPresent: nodes.some(node => node.res === target),
        expectedTextPresent: nodes.some(node => node.res === target && (expected === undefined || node.text === expected)) });
    } catch { /* diagnostic only */ }
  };
  try { return await assertion(observe); }
  catch (error) {
    try { if (samples.length) write(JSON.stringify({ samples })); } catch { /* preserve original error */ }
    throw error;
  }
}
