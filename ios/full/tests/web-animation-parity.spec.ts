import { expect, test } from '@playwright/test';
import { launchApplication, waitForHall, simulatorAppPath } from '../device';
import { withIosProxy } from '../proxy';
import { selectLanguage, signIn, tap, navigateScenario } from '../navigation';
import { iosScenarios } from '../scenarios';
import { captureNativeTransition } from '../animation-transition';
import { captureFailure } from '../diagnostics';
import { assertBrandFade, clickNode, launchBrandPixelBounds } from '../web-animation-parity';
import type { ScreenshotMask } from '../screenshot';
import { recordNativeVideoFrames } from '../video-frames';
import { launchArtworkTemplate } from '../launch-artwork';
import { frameColorDistance } from '../animation-transition';
import { setTimeout as delay } from 'node:timers/promises';
import { stagingCardBounds } from '../staging-card';
import { brandFadeEvidence, captureBrandFadeWithStartRecapture } from '../brand-fade';

const locale = process.env.IOS_LOCALE || 'en';
const group = process.env.IOS_GROUP || 'all';
const enabled = (business: string, language: string) => ['all', business].includes(group) && locale === language;
const source = (path: string, title: string) => [{ type: 'web-animation-source', description: `${path}: ${title}` }];

if (enabled('guest', 'zh-Hans')) test('zh-Hans mobile guest search prompt fades in and reopens on iOS', {
  annotation: source('visual/animations/search-prompt.spec.ts', 'zh-Hans mobile guest search prompt fades in'),
}, async ({}, info) => {
  test.setTimeout(1_200_000);
  await withIosProxy(async () => {
    const device = await launchApplication();
    try {
      await waitForHall(device); await selectLanguage(device, 'zh-Hans'); await tap(device, 'hall-tab');
      await tap(device, 'hall-search-button');
      await device.wait({ res: 'pop-up-message-text', text: '请先登录以使用搜索功能' });
      const region = (await device.info({ res: 'confirm-pop-up-image-background' })).bounds;
      await tap(device, 'cancel-button'); await device.wait({ res: 'pop-up-message-text' }, { state: 'gone' });
      await captureNativeTransition(device, 'zh-Hans-search-confirmation-enter', info, region,
        () => clickNode(device, { res: 'hall-search-button' }), [], [], 0, 'videoFrames', undefined,
        () => device.wait({ res: 'pop-up-message-text', text: '请先登录以使用搜索功能' }));
      await captureNativeTransition(device, 'zh-Hans-search-confirmation-exit', info, region,
        () => clickNode(device, { res: 'cancel-button' }));
      await device.wait({ res: 'pop-up-message-text' }, { state: 'gone' });
      await tap(device, 'hall-search-button');
      await device.wait({ res: 'pop-up-message-text', text: '请先登录以使用搜索功能' });
      await tap(device, 'cancel-button');
    } catch (error) { await captureFailure(device, info); throw error; }
    finally { await device.close(); }
  });
});

if (enabled('wallet-help', 'en')) test('share link opens and closes the real iOS share sheet', {
  annotation: source('visual/animations/dialogs.spec.ts', 'share link confirmation dialog enter and exit'),
}, async ({}, info) => {
  test.setTimeout(1_200_000);
  await withIosProxy(async () => {
    const device = await launchApplication();
    const copy = { clazz: /XCUIElementType(Button|Cell)/, text: /^(Copy|Copy Link)$/ };
    const close = { clazz: 'XCUIElementTypeButton', text: /^(Close|Cancel)$/ };
    try {
      await waitForHall(device); await signIn(device);
      const scenario = iosScenarios('en', 'wallet-help').find(item => item.pageLabel === 'signed_in_share_app');
      expect(scenario).toBeDefined(); await navigateScenario(device, scenario!);
      // 系统分享选项实际出现在 XCUITest 树中；不点击 Messages/Mail 等发送入口。
      await captureNativeTransition(device, 'ios-share-sheet-enter', info, { x: 0, y: 0, ...device.screenSize },
        () => clickNode(device, { res: 'share-button' }), [], [], 0, 'videoFrames', undefined, () => device.wait(copy));
      const options = await device.nodes();
      expect(options.some(node => /^(AirDrop|Messages|Mail)$/.test(node.text || '')), '必须有原生系统分享目标').toBe(true);
      expect((await device.info(copy)).enabled, '系统复制链接选项须可用').toBe(true);
      await captureNativeTransition(device, 'ios-share-sheet-exit', info, { x: 0, y: 0, ...device.screenSize },
        () => clickNode(device, close), [], [], 0, 'videoFrames', undefined, () => device.wait(copy, { state: 'gone' }));
      await device.wait({ res: 'share-button' });
    } catch (error) { await captureFailure(device, info); throw error; }
    finally { await device.close(); }
  });
});

if (enabled('social', 'en')) test('hall matching modal records its native entrance before cancellation', {
  annotation: source('visual/animations/application.spec.ts', 'hall matching spinner modal enter and exit'),
}, async ({}, info) => {
  test.setTimeout(1_200_000);
  await withIosProxy(async () => {
    const device = await launchApplication();
    try {
      await waitForHall(device); await signIn(device); await tap(device, 'hall-tab');
      await tap(device, 'match-game-item-texas_holdem-tourists'); await device.wait({ res: 'game-matching-loading-view' });
      const region = (await device.info({ res: 'game-matching-loading-view' })).bounds;
      const masks: ScreenshotMask[] = (await device.nodes()).filter(node => node.res === 'game-matching-countdown-text'
        || (/Image|ActivityIndicator/.test(node.clazz) && node.bounds.x >= region.x && node.bounds.y >= region.y
          && node.bounds.x + node.bounds.width <= region.x + region.width && node.bounds.y + node.bounds.height <= region.y + region.height))
        .map(node => ({ ...node.bounds, reason: '独立旋转图标/计时数字由原有hall-matching循环动画案例比较' }));
      await tap(device, 'quick-start-room-cancel'); await device.wait({ res: 'game-matching-loading-view' }, { state: 'gone' });
      await captureNativeTransition(device, 'hall-matching-modal-enter', info, region,
        () => clickNode(device, { res: 'match-game-item-texas_holdem-tourists' }), masks, [], 0, 'videoFrames', undefined,
        () => device.wait({ res: 'game-matching-loading-view' }));
      await tap(device, 'quick-start-room-cancel'); await device.wait({ res: 'game-matching-loading-view' }, { state: 'gone' });
    } catch (error) { await captureFailure(device, info); throw error; }
    finally { await device.close(); }
  }, false, true);
});

if (enabled('guest', 'en')) test('launch branding independently fades in while real initialization waits', {
  annotation: source('visual/animations/ambient.spec.ts', 'launch branding fades in'),
}, async ({}, info) => {
  test.setTimeout(1_200_000);
  await withIosProxy(async proxy => {
    const device = await launchApplication();
    try {
      await device.wait({ res: 'staging-confirmation-input' });
      const captured = await captureBrandFadeWithStartRecapture(async attempt => {
        await proxy.command('android/launch-network', { hold: true });
        await device.terminate(); await device.home(); await delay(1000);
        const before = await device.nativeScreenshot();
        // 品牌淡入发生在真正启动时；模态框后的原生子树仍提供文字的真实布局。
        const frames = await recordNativeVideoFrames(device, `independent-launch-branding-enter-attempt-${attempt}`,
          { x: 0, y: 0, ...device.screenSize }, () => device.launch(), info, 7000);
        expect(frameColorDistance(before, frames[0]), '录像必须包含activate前的真实屏幕').toBeLessThan(10);
        await device.wait({ res: 'staging-confirmation-input' }); await delay(1200);
        const finalFrame = await device.nativeScreenshot();
        const nodes = await device.nodes();
        const dialog = stagingCardBounds(nodes, device.screenSize);
        const brand = launchBrandPixelBounds(nodes, device.screenSize);
        await expect.poll(async () => {
          const network = await proxy.command<{ requested: number; lastRequestedAt: number }>('android/launch-network');
          expect(network.requested).toBeGreaterThan(0); return Date.now() - network.lastRequestedAt;
        }, { timeout: 30_000 }).toBeGreaterThan(6000);
        // 旧请求已过期；在确认提示并触发下一次健康检查前释放网络，避免布局查询
        // 消耗应用自身的 5 秒请求窗口。不可吞掉真正的系统网络错误弹窗。
        await proxy.command('android/launch-network', { hold: false });
        await device.fill({ res: 'staging-confirmation-input' }, 'CONFIRM'); await device.hideKeyboard();
        await tap(device, 'confirm-button'); await device.wait({ res: 'staging-dialog' }, { state: 'gone' });
        await device.wait({ res: 'hall-tab' }, { timeout: 120_000 });
        const region = { ...brand, height: Math.min(brand.y + brand.height, dialog.y - 4) - brand.y };
        expect(region.height, '遮罩上方须有足够真实品牌文字可测').toBeGreaterThan(20);
        const { width, height } = device.screenSize;
        const exclusions = [dialog, { x: 0, y: 0, width, height: Math.ceil(height * .08) },
          { x: 0, y: Math.floor(height * .96), width, height: Math.ceil(height * .04) }];
        await info.attach(`launch-branding-native-region-attempt-${attempt}`, { body: JSON.stringify({ brand, dialog, region }), contentType: 'application/json' });
        const reference = launchArtworkTemplate(await simulatorAppPath(), width, height);
        const evidence = brandFadeEvidence(frames, finalFrame, reference, region, exclusions);
        await info.attach(`launch-branding-fade-opacity-fit-attempt-${attempt}`, {
          body: JSON.stringify(evidence), contentType: 'application/json',
        });
        return { frames, finalFrame, reference, region, exclusions, evidence };
      }, reason => info.attach('launch-branding-start-recapture-reason', {
        body: reason, contentType: 'text/plain',
      }));
      await assertBrandFade(captured.frames, captured.finalFrame, captured.reference,
        captured.region, captured.exclusions, info, captured.evidence);
    } catch (error) { await captureFailure(device, info); throw error; }
    finally { try { await proxy.command('android/launch-network', { hold: false }); } finally { await device.close(); } }
  });
});
