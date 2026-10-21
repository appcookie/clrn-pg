import { expect } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { gameSession } from './game-room';
import { gameNodes, gameNodesWithin, gameSemanticText } from './game-controls';

/**
 * 复用 Web 回放控制接口，且只允许本轮真实建房响应中登记的 UUID。
 * @param proxy - 本轮独占代理。
 * @param game - 共用的玩法代理名。
 * @param roomId - 本轮创建的房间。
 * @param data - Web 共用的网络事件夹具。
 */
export async function replay(proxy: Mitmproxy, game: 'texas' | 'zhajinhua', roomId: string, data: unknown): Promise<void> {
  expect((await gameSession(proxy)).room?.roomId, '回放只能发送到本轮新建的私人房').toBe(roomId);
  // Read-only preparation may observe a reconnect, but a mutation is never
  // repeated. A channel counts only after the server acknowledged its subscribe.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await proxy.command<{ ready: boolean; confirmedSubscriptions: number;
      liveConnections: number; pendingSubscriptions: number }>(`${game}/replay-ready`, { roomId });
    expect(typeof state.ready, '代理必须返回真实订阅就绪状态').toBe('boolean');
    for (const count of [state.confirmedSubscriptions, state.liveConnections, state.pendingSubscriptions]) {
      expect(Number.isSafeInteger(count) && count >= 0, '代理订阅计数必须有效').toBe(true);
    }
    expect(state.ready, '就绪状态必须对应活跃且已获服务端确认的房间订阅')
      .toBe(state.confirmedSubscriptions > 0 && state.liveConnections > 0);
    if (state.ready) break;
    expect(Date.now(), '发送前等待本轮房间真实订阅超时，未发送任何事件').toBeLessThan(deadline);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  // Publication precedes the HTTP acknowledgement. A lost/failed response
  // cannot prove nothing was injected, so never repeat this mutation.
  await proxy.command(`${game}/replay`, { roomId, data });
}

/**
 * 断言可见牌面容器关联的牌名。辅助文字可能被 Android 裁到父容器外，
 * 只从实际可见的牌面容器读取它，不能把屏外历史牌面计入当前状态。
 * @param device - 专用模拟器连接。
 * @param container - 当前牌面的可见容器 ID。
 * @param marker - 容器内的语义牌名 ID。
 * @param expected - 顺序无关的预期文字。
 * @param options - 可限定前景区域，或仅验证已取得牌名的明牌。
 */
export async function gameCardNames(device: AndroidDevice, container: string, marker: string, expected: string[],
  options: { scope?: string; namedOnly?: boolean } = {}): Promise<void> {
  await expect.poll(async () => {
    const started = performance.now();
    const nodes = await gameNodes(device);
    const names = (options.scope ? gameNodesWithin(nodes, options.scope) : nodes).filter(node => node.res === container)
      .map(node => gameSemanticText(node, marker) || '')
      .filter(text => !options.namedOnly || text !== '').sort();
    console.log(`IOS > 牌面观测 ${container}：${JSON.stringify({ names, elapsedMs: Math.round(performance.now() - started) })}`);
    return names;
  },
  // 39577732340 的河牌恢复在30秒内只暴露四个可见容器，失败后的原生树
  // 和截图均有完整五张牌；沿用普通控件的45秒只读就绪预算，不重发牌局。
  { timeout: 45_000, intervals: [250] }).toEqual([...expected].sort());
}
