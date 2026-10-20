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
  await expect(async () => {
    await proxy.command(`${game}/replay`, { roomId, data });
  }).toPass({ timeout: 30_000, intervals: [500] });
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
    const nodes = await gameNodes(device);
    return (options.scope ? gameNodesWithin(nodes, options.scope) : nodes).filter(node => node.res === container)
      .map(node => gameSemanticText(node, marker) || '')
      .filter(text => !options.namedOnly || text !== '').sort();
  },
  { timeout: 30_000, intervals: [250] }).toEqual([...expected].sort());
}
