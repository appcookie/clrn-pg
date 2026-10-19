import { expect, test } from '@playwright/test';
import { assertVisual, launchApplication, simulatorAppPath, waitForHall } from '../device';
import { captureFailure } from '../diagnostics';
import { selectLanguage, tap } from '../navigation';
import { withAndroidProxy } from '../proxy';
import { gameReady } from '../game-controls';
import { waitForHallAfterLaunchHold } from '../launch-recovery';
import { captureLaunchBranding, launchScreenshot, verifyLaunchCapture } from '../launch-capture';
import { launchArtworkTemplate } from '../launch-artwork';

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
        // 健康请求只有5秒窗口：一轮并行采集后即释放，所有像素与baseline验证离线执行。
        const capture = await captureLaunchBranding({ nodes: () => device.nodes(),
          screenshot: () => launchScreenshot(device.udid, device.screenSize),
          release: () => proxy.command('android/launch-network', { hold: false }) });
        await info.attach('launch-capture-window', { body: JSON.stringify({ elapsedMs: capture.elapsedMs,
          releasedByBudget: capture.releasedByBudget }), contentType: 'application/json' });
        await info.attach('launch-branding-captured', { body: capture.bytes, contentType: 'image/png' });
        const reference = launchArtworkTemplate(await simulatorAppPath(), device.screenSize.width, device.screenSize.height);
        const evidence = verifyLaunchCapture(capture.bytes, capture.nodes, device.screenSize, reference);
        await info.attach('launch-capture-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
        await assertVisual(capture.bytes, `${locale}-launch-branding`, info);
        const recovery = await waitForHallAfterLaunchHold(device);
        await info.attach('launch-health-recovery', { body: JSON.stringify(recovery), contentType: 'application/json' });
      } catch (error) { await captureFailure(device, info); throw error; }
      finally {
        try { await proxy.command('android/launch-network', { hold: false }); }
        finally { await device.close(); }
      }
    });
  });
}
