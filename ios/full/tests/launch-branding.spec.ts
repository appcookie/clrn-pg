import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareScreenshot, launchApplication, waitForHall } from '../device';
import { captureFailure } from '../diagnostics';
import { selectLanguage, tap } from '../navigation';
import { withAndroidProxy } from '../proxy';
import { gameReady } from '../game-controls';

const locale = process.env.IOS_LOCALE || 'en';
if (['all', 'guest'].includes(process.env.IOS_GROUP || 'all')) {
  test(`${locale} launch_branding full screen while initialization waits`, async ({}, info) => {
    test.setTimeout(1_200_000);
    await withAndroidProxy(async proxy => {
      const device = await launchApplication();
      try {
        await waitForHall(device);
        await selectLanguage(device, locale);
        await proxy.command('android/launch-network', { hold: true });
        await device.restart();
        await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120000 });
        const confirmation = { en: 'CONFIRM', 'zh-Hans': '确认', 'zh-Hant': '確認' }[locale];
        expect(confirmation).toBeDefined();
        await device.fill({ res: 'staging-confirmation-input' }, confirmation!);
        await device.hideKeyboard();
        const button = await gameReady(device, 'confirm-button');
        expect(button.enabled).toBe(true);
        // 等健康检查真实超时，再通过确认按钮触发正常初始化窗口。
        await expect.poll(async () => {
          const network = await proxy.command<{ requested: number; lastRequestedAt: number }>('android/launch-network');
          expect(network.requested).toBeGreaterThan(0);
          return Date.now() - network.lastRequestedAt;
        }, { timeout: 30000, intervals: [500] }).toBeGreaterThan(6000);
        await tap(device, 'confirm-button');
        await device.wait({ res: 'launch-screen-container' }, { timeout: 4000 });
        await device.wait({ res: 'staging-dialog' }, { state: 'gone', timeout: 4000 });
        const assertBranding = async () => {
          const nodes = await device.nodes();
          expect(nodes.some(node => node.res === 'launch-screen-container')).toBe(true);
          expect(nodes.some(node => node.res === 'staging-dialog')).toBe(false);
          expect(nodes.some(node => node.clazz === 'XCUIElementTypeAlert'), '不能把系统错误弹窗当品牌页').toBe(false);
        };
        const fullScreen = async () => {
          const bytes = await device.nativeScreenshot();
          const picture = PNG.sync.read(bytes);
          expect({ width: picture.width, height: picture.height }).toEqual(device.screenSize);
          return bytes;
        };
        // 初始化的真实超时窗口很短；使用瞬态截图的前后断言，避免重复读取整棵树耗尽窗口。
        await compareScreenshot(device, `${locale}-launch-branding`, info, [], assertBranding, fullScreen);
        await proxy.command('android/launch-network', { hold: false });
        await device.wait({ res: 'settings-tab' }, { timeout: 120000 });
      } catch (error) { await captureFailure(device, info); throw error; }
      finally {
        try { await proxy.command('android/launch-network', { hold: false }); }
        finally { await device.close(); }
      }
    });
  });
}
