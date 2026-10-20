import { expect, test } from '@playwright/test';
import { assertVisual, launchApplication, simulatorAppPath, waitForHall } from '../device';
import { captureFailure } from '../diagnostics';
import { selectLanguage, tap } from '../navigation';
import { withAndroidProxy } from '../proxy';
import { gameReady } from '../game-controls';
import { waitForHallAfterLaunchHold } from '../launch-recovery';
import { captureLaunchBranding, launchScreenshot, verifyLaunchCapture } from '../launch-capture';
import { recordNativeVideoFrames } from '../video-frames';
import { launchArtworkTemplate } from '../launch-artwork';
import { frameColorDistance } from '../animation-transition';
import { baselinePath } from '../baseline-path.mjs';
import { readFileSync } from 'node:fs';

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
        // 先让 Simulator 开始录制真实帧，再点确认。慢 runner 的 simctl 单帧截图
        // 曾耗时 7–10 秒，应用已到大厅；录像保留了同一启动窗口内的原始帧。
        let captured: Awaited<ReturnType<typeof captureLaunchBranding>> | undefined;
        const frames = await recordNativeVideoFrames(device, 'launch-branding-window',
          { x: 0, y: 0, ...device.screenSize }, async () => {
            await tap(device, 'confirm-button');
            // 健康请求只有5秒窗口：一轮并行采集后即释放，像素验证离线执行。
            captured = await captureLaunchBranding({ nodes: () => device.nodes(),
              screenshot: () => launchScreenshot(device.udid, device.screenSize),
              release: () => proxy.command('android/launch-network', { hold: false }) });
          // 这是静态品牌页采集：真实 Simulator 在健康请求停住时按需编码，
          // 14 秒内可只有 17 个不同 PTS。仍要求至少 12 帧和后续完整插画校验。
          }, info, 500, 12);
        if (!captured) throw new Error('启动录屏结束后缺少原生截图');
        const capture = captured;
        await info.attach('launch-capture-window', { body: JSON.stringify({ elapsedMs: capture.elapsedMs,
          releasedByBudget: capture.releasedByBudget }), contentType: 'application/json' });
        await info.attach('launch-branding-captured', { body: capture.bytes, contentType: 'image/png' });
        const reference = launchArtworkTemplate(await simulatorAppPath(), device.screenSize.width, device.screenSize.height);
        let bytes = capture.bytes;
        let selectedFromVideo = false;
        let evidence: ReturnType<typeof verifyLaunchCapture>;
        try { evidence = verifyLaunchCapture(bytes, capture.nodes, device.screenSize, reference); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== '截图不是完整无遮挡的发布包启动插画'
            || !capture.releasedByBudget || capture.elapsedMs <= 4000) throw error;
          // 仅当原图超过健康窗口并已释放 hold，才在同一真实视频里寻找完整
          // 启动画面。每帧仍通过原有无遮挡、发布包背景与品牌文字断言。
          let found: { index: number; bytes: Buffer; evidence: ReturnType<typeof verifyLaunchCapture> } | undefined;
          for (let index = 0; index < frames.length; index++) {
            try {
              const candidate = verifyLaunchCapture(frames[index], capture.nodes, device.screenSize, reference);
              found = { index, bytes: frames[index], evidence: candidate };
              break;
            } catch (candidateError) {
              if (!(candidateError instanceof Error)
                || !['截图不是完整无遮挡的发布包启动插画', '启动页缺少真实可见的品牌文字像素'].includes(candidateError.message)) {
                throw candidateError;
              }
            }
          }
          if (!found) throw error;
          bytes = found.bytes;
          selectedFromVideo = true;
          evidence = found.evidence;
          await info.attach('launch-branding-video-frame-selection', { body: JSON.stringify({
            source: 'same-real-simulator-video', frameIndex: found.index,
            originalTimestampMs: frames.timestampsMs?.[found.index],
            lateScreenshotElapsedMs: capture.elapsedMs,
          }), contentType: 'application/json' });
          await info.attach('launch-branding-selected-video-frame', { body: bytes, contentType: 'image/png' });
        }
        await info.attach('launch-capture-evidence', { body: JSON.stringify(evidence), contentType: 'application/json' });
        if (selectedFromVideo && process.env.IOS_VISUAL_MODE === 'compare') {
          // 只在 simctl 原始截图超出健康窗口时使用视频回退；H.264 编码引入
          // 小范围色差，仍须同时通过上面的原生节点、素材与品牌字检查。
          const name = `${locale}-launch-branding.png`;
          await info.attach(name, { body: bytes, contentType: 'image/png' });
          expect(frameColorDistance(bytes, readFileSync(baselinePath(name))),
            '视频回退的完整启动页须接近已审查基准').toBeLessThanOrEqual(12);
        } else await assertVisual(bytes, `${locale}-launch-branding`, info);
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
