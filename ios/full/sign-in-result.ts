import { setTimeout as delay } from 'node:timers/promises';
import type { NativeDevice } from './native-device';

async function observeResult(device: Pick<NativeDevice, 'nodes' | 'alertText'>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const nodes = await device.nodes();
    if (nodes.some(node => node.clazz === 'XCUIElementTypeAlert' && node.visible !== false)) {
      const message = await device.alertText();
      if (message?.trim() === 'Request failed with status code 502') return false;
      throw new Error('登录被原生错误弹窗阻断');
    }
    if (nodes.some(node => node.res === 'settings-tab' && node.visible !== false)) return true;
    if (Date.now() >= deadline) throw new Error('登录后等待主标签超时');
    await delay(250);
  }
}

/** Only a confirmed gateway rejection may resubmit the unchanged login form once. */
export async function waitForSignInResult(device: Pick<NativeDevice, 'nodes' | 'alertText' | 'acceptAlert'>,
  submit: () => Promise<void>, timeout = 60_000): Promise<void> {
  await submit();
  if (await observeResult(device, timeout)) return;
  await device.acceptAlert();
  await submit();
  if (!await observeResult(device, timeout)) throw new Error('登录被原生错误弹窗阻断：重试后仍返回 HTTP 502');
}
