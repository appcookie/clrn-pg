// 独立代理与原生应用fixture，失败时保存脱敏诊断，不伪造登录状态。
import { test as base } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NativeDevice } from './native-device';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { launchApplication, waitForHall } from './device';
import { withIosProxy } from './proxy';
import { selectLanguage } from './navigation';
import { captureFailure, safeNativeTree, safeFailureScreenshot } from './diagnostics';
export const locale = process.env.IOS_LOCALE || 'en';
export const test = base.extend<{}, {
  application: { device: NativeDevice; signedIn: boolean; proxy: Mitmproxy };
  clubRoomsPopulated: boolean;
}>({
  // 不同的工作会话选项让有牌局场景独占应用和代理，空态仍使用默认会话。
  clubRoomsPopulated: [false, { scope: 'worker', option: true }],
  application: [async ({ clubRoomsPopulated }, use, workerInfo) => {
    if (!process.env.IOS_GROUP || process.env.IOS_GROUP === 'all') throw new Error('原生执行必须指定IOS_GROUP；all只用于收集清单，CI会按组拆分以隔离真实网络与视觉夹具。');
    await withIosProxy(async proxy => {
      const device = await launchApplication();
      let ready = false;
      try {
        await waitForHall(device);
        await selectLanguage(device, locale);
        if (clubRoomsPopulated) await proxy.command('native/club-rooms', { active: true });
        ready = true;
        await use({ device, signedIn: false, proxy });
      } catch (error) {
        if (!ready) {
          // worker fixture 失败时 afterEach 无法获得设备，提前保存可审查的脱敏证据。
          const directory = resolve(workerInfo.project.outputDir, `setup-${workerInfo.workerIndex}`);
          mkdirSync(directory, { recursive: true });
          const nodes = await device.nodes().catch(() => undefined);
          if (nodes) {
            writeFileSync(resolve(directory, 'accessibility.json'), JSON.stringify(safeNativeTree(nodes), null, 2));
            await device.nativeScreenshot().then(bytes => writeFileSync(resolve(directory, 'screen.png'),
              safeFailureScreenshot(bytes, nodes))).catch(() => {});
          }
        }
        throw error;
      } finally { await device.close(); }
    }, false, false, false, false, false, { visual: !['functional', 'functional-creation', 'interaction', 'network'].includes(process.env.IOS_GROUP || '') });
  }, { scope: 'worker', timeout: 900_000 }],
});
test.afterEach(async ({ application }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await captureFailure(application.device, testInfo);
});
