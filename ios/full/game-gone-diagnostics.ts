type ObservationNode = { res?: string; text?: string; visible?: boolean };
type Sample = { elapsedMs: number; queryMs: number; targetPresent: boolean; connecting: boolean; timeout: boolean };

/** 只记录原断言已有的样本；不查询设备，不改变采样或异常。 */
export async function observeGameGone(target: string,
  assertion: (observe: (nodes: ObservationNode[], queryStarted: number) => void) => Promise<unknown>): Promise<void> {
  const samples: Sample[] = [];
  const started = Date.now();
  const observe = (nodes: ObservationNode[], queryStarted: number) => {
    try {
      samples.push({ elapsedMs: Date.now() - started, queryMs: Date.now() - queryStarted,
        targetPresent: nodes.some(node => node.res === target),
        connecting: nodes.some(node => /Connecting\.\.\./.test(node.text || '')),
        timeout: nodes.some(node => node.visible !== false && /Connection Timeout/i.test(node.text || '')) });
      if (samples.length > 16) samples.shift();
    } catch { /* diagnostic only */ }
  };
  try { await assertion(observe); }
  catch (error) {
    try {
      const marker = ['zhajinhua-operation-button-call', 'buy-in-title'].includes(target) ? target : '<other>';
      console.error('[gameGone observations]', JSON.stringify({ target: marker, samples }));
    } catch { /* diagnostic only */ }
    throw error;
  }
}
