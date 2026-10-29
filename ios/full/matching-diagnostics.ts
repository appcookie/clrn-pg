import type { TestInfo } from '@playwright/test';
import type { NativeTapObservation } from './navigation';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';

type Stage = 'prepare-join' | 'prepare-cancel' | 'recorded-join' | 'recorded-cancel' | 'spinner-join' | 'spinner-cancel';
type Target = 'match-game-item-texas_holdem-tourists' | 'quick-start-room-cancel';

/** 一次操作的驱动回执与界面断言分开；当前测试驱动不能观测固定包的 JS 回调/内部状态。 */
export class MatchingTrace {
  private events: object[] = [];
  constructor(private proxy: Pick<Mitmproxy, 'command'>, private info: Pick<TestInfo, 'attach'>) {}

  async input(stage: Stage, target: Target,
    action: (observe: (value: NativeTapObservation) => void) => Promise<void>): Promise<void> {
    const event = { stage, target, startedUtc: new Date().toISOString(),
      inputRequestedUtc: undefined as string | undefined, driverReturnedUtc: undefined as string | undefined,
      completedUtc: undefined as string | undefined,
      driver: 'not-requested', appCallback: 'unknown', appConnectionState: 'unknown',
      observation: undefined as object | undefined };
    this.events.push(event);
    try {
      await action(value => {
        // 不保留标签、attributes、原生元素 ID、错误正文或整棵树。
        event.observation = { identityMatches: value.target.res === target,
          observedAtUtc: value.observedAtUtc,
          visible: value.target.visible, enabled: value.target.enabled,
          bounds: { x: value.target.bounds.x, y: value.target.bounds.y,
            width: value.target.bounds.width, height: value.target.bounds.height },
          point: { x: value.point.x, y: value.point.y },
          connectionUi: { connecting: value.connectionUi.connecting, timeout: value.connectionUi.timeout } };
        event.inputRequestedUtc = new Date().toISOString();
        event.driver = 'requested';
      });
      event.driverReturnedUtc = new Date().toISOString();
      event.driver = 'returned';
    } catch (error) {
      event.driver = event.inputRequestedUtc ? 'failed' : 'preparation-failed';
      throw error;
    } finally { event.completedUtc = new Date().toISOString(); }
  }

  async modal(stage: Stage, expected: 'visible' | 'gone', assertion: () => Promise<void>): Promise<void> {
    const event = { stage, expected, startedUtc: new Date().toISOString(),
      completedUtc: undefined as string | undefined, assertion: 'failed' };
    this.events.push(event);
    try { await assertion(); event.assertion = 'passed'; }
    finally { event.completedUtc = new Date().toISOString(); }
  }

  /** 成功、点击失败、弹窗超时均保存；诊断失败不能替换原有业务失败。 */
  async save(checkpoint: 'before-matching' | 'prepare-cancel' | 'recorded-cancel' | 'spinner-cancel' | 'final') {
    let transport: unknown;
    try { transport = await this.proxy.command('native/transport'); }
    catch { transport = { unavailable: true }; }
    await this.info.attach(`matching-diagnostics-${checkpoint}`, {
      contentType: 'application/json', body: JSON.stringify({ sampledAtUtc: new Date().toISOString(),
        callbackObservation: 'not-observable-from-test-harness',
        connectionObservation: 'UI hints and proxy socket state only; application state unknown',
        events: this.events, transport }),
    }).catch(() => { console.error('[matching diagnostics] attachment unavailable'); });
  }
}
