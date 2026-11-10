/** 截图采集已有调用的 UTC 与耗时；不查询设备或调整采样条件。 */
export function captureTiming() {
  const samples: { startedUtc: string; completedUtc: string; elapsedMs: number }[] = [];
  return {
    async read<T>(take: () => Promise<T>): Promise<T> {
      const started = Date.now();
      try { return await take(); }
      finally {
        try {
          samples.push({ startedUtc: new Date(started).toISOString(), completedUtc: new Date().toISOString(),
            elapsedMs: Date.now() - started });
          if (samples.length > 16) samples.shift();
        } catch { /* diagnostic only */ }
      }
    },
    source(name: string, take: () => Promise<Buffer>) {
      return name.endsWith('-pre-game-waiting-table') ? () => this.read(take) : undefined;
    },
    report() {
      try { if (samples.length) console.error('[waiting-table capture timing]', JSON.stringify(samples)); }
      catch { /* diagnostic only */ }
    },
  };
}
