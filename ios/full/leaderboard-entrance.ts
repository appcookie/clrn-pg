// #23：只记录原生单次输入与录后可见状态，不把驱动回执当作应用处理成功。
import type { TestInfo } from '@playwright/test';
import type { NativeDevice } from './native-device';
import { gameTapCurrent, type NativeNode } from './game-controls';

export const zhajinhuaLeaderboardButton = 'zhajinhua-learder-borard-button';
const panelMarkers = ['public-leader-board-container', 'public-leader-board-empty',
  'public-leader-board-loading'];
const utc = () => new Date().toISOString();
const connection = (nodes: NativeNode[]) => ({
  connecting: nodes.some(node => node.visible !== false && /Connecting\.\.\./.test(node.text || '')),
  timeoutVisible: nodes.some(node => node.visible !== false && /Connection Timeout/i.test(node.text || '')),
});
// 只保留固定标记、几何量与布尔值；不保存昵称、房间号、完整树或驱动错误正文。
const targets = (nodes: NativeNode[], resource: string) => nodes.filter(node => node.res === resource)
  .map(node => ({ resource, visible: node.visible, enabled: node.enabled, bounds: { ...node.bounds } }));

/** 录屏预热后重新观察目标和连接，两份稳定布局只触发一次真实输入。 */
export async function tapRecordedLeaderboard(device: NativeDevice, testInfo: TestInfo): Promise<void> {
  const observations: { completedUtc: string; connection: ReturnType<typeof connection>;
    targets: ReturnType<typeof targets> }[] = [];
  const evidence: { preparationStartedUtc: string; completedUtc?: string; observationCount: number;
    observations: typeof observations; driverReceipt: 'not-requested' | 'pending' | 'returned' | 'driver-error';
    tapRequestedUtc?: string; driverReturnedUtc?: string; driverFailedUtc?: string; point?: { x: number; y: number };
    applicationProcessing: 'unobserved' } = {
    preparationStartedUtc: utc(), observationCount: 0, observations,
    driverReceipt: 'not-requested', applicationProcessing: 'unobserved',
  };
  try {
    await gameTapCurrent(device, zhajinhuaLeaderboardButton, undefined, point => {
      if (point.x < 0 || point.y < 0 || point.x >= device.screenSize.width || point.y >= device.screenSize.height)
        throw new Error('排行榜点击位置必须位于真实屏幕内');
      evidence.point = { ...point };
      evidence.tapRequestedUtc = utc();
      evidence.driverReceipt = 'pending';
    }, nodes => {
      evidence.observationCount++;
      observations.push({ completedUtc: utc(), connection: connection(nodes),
        targets: targets(nodes, zhajinhuaLeaderboardButton) });
      // 保留最终稳定对及之前的连接状态，限制长重连时的附件大小。
      if (observations.length > 16) observations.shift();
    });
    evidence.driverReturnedUtc = utc();
    evidence.driverReceipt = 'returned';
  } catch (error) {
    if (evidence.driverReceipt === 'pending') {
      evidence.driverReceipt = 'driver-error';
      evidence.driverFailedUtc = utc();
    }
    throw error;
  } finally {
    evidence.completedUtc = utc();
    await testInfo.attach('zhajinhua-leaderboard-enter-input', {
      body: JSON.stringify(evidence), contentType: 'application/json',
    });
  }
}

/** 在原有录后断言结束（含失败）时保存当前语义，先于测试清理；不再点击。 */
export async function withRecordedLeaderboardEvidence(device: NativeDevice, testInfo: TestInfo,
  assertReady: () => Promise<void>): Promise<void> {
  const evidence: { startedUtc: string; completedUtc?: string; assertionsPassed: boolean;
    observation?: { source: 'target-query'; completedUtc: string; connection: ReturnType<typeof connection>;
      markers: { resource: string; targets: ReturnType<typeof targets> }[] };
    observationFailed?: boolean } = { startedUtc: utc(), assertionsPassed: false };
  let assertionFailed = false;
  try {
    await assertReady();
    evidence.assertionsPassed = true;
  } catch (error) {
    assertionFailed = true;
    throw error;
  } finally {
    try {
      await device.prepareTransientCapture();
      const nodes = await device.inputObservation(panelMarkers);
      evidence.observation = { source: 'target-query', completedUtc: utc(), connection: connection(nodes),
        markers: panelMarkers.map(resource => ({ resource, targets: targets(nodes, resource) })) };
    } catch (error) {
      evidence.observationFailed = true;
      // 次要诊断故障不能覆盖原有可见性断言的失败。
      if (!assertionFailed) throw error;
    } finally {
      evidence.completedUtc = utc();
      await testInfo.attach('zhajinhua-leaderboard-enter-semantics', {
        body: JSON.stringify(evidence), contentType: 'application/json',
      });
    }
  }
}
