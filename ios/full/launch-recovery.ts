import { setTimeout as delay } from 'node:timers/promises';
import type { NativeDevice } from './native-device';

/** 仅用于启动截图测试释放故意注入的健康检查 hold 之后，不能作为通用弹窗清理。 */
export async function waitForHallAfterLaunchHold(
  device: Pick<NativeDevice, 'alertText' | 'execute' | 'nodes'>, timeout = 120_000,
): Promise<{ retried: boolean }> {
  const deadline = Date.now() + timeout;
  let retried = false;
  do {
    const alert = await device.alertText();
    if (alert !== null) {
      const healthFailure = /ServerType:\s*staging\b/.test(alert)
        && /Message:\s*\d+\s+v1\/status\b/.test(alert)
        && /\b(?:503\s+server_down|5004\s+request_timeout)\b/.test(alert);
      if (!healthFailure) throw new Error('释放启动 hold 后出现非预期原生弹窗，不能自动跳过');
      if (retried) throw new Error('启动健康检查重试后再次失败，不能重复重试掩盖错误');
      // XCUITest mobile: alert 按原生按钮标签操作，不能依赖默认 accept 或盲点坐标。
      const buttons: unknown = await device.execute('mobile: alert', { action: 'getButtons' });
      const retryButtons = Array.isArray(buttons) ? buttons.filter(value => /^(Retry|重试|重試)$/.test(value)) : [];
      if (retryButtons.length !== 1) throw new Error('健康错误弹窗没有唯一的原生重试按钮');
      retried = true;
      await device.execute('mobile: alert', { action: 'accept', buttonLabel: retryButtons[0] });
    } else if ((await device.nodes()).some(node => node.res === 'settings-tab')) {
      return { retried };
    }
    if (Date.now() < deadline) await delay(250);
  } while (Date.now() < deadline);
  throw new Error('释放启动 hold 后未进入大厅');
}
