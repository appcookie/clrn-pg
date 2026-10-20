import { screenPoint } from '../screen-geometry';
import { screenBounds } from '../screen-geometry';
import { expect, test } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from '../native-device';
import { compareScreenshot, launchApplication, waitForHall } from '../device';
import { captureNativeTransition } from '../animation-transition';
import { verifyLaunchArtwork } from '../launch-artwork';
import { stagingCardBounds } from '../staging-card';
import { captureFailure } from '../diagnostics';
import { withAndroidProxy } from '../proxy';
import { signIn, navigateScenario, tap, reveal } from '../navigation';
import { androidScenarios } from '../scenarios';
import { screenshotMasks } from '../screenshot';
import { verifyLoopAnimation } from '../loop-animation';
import { gameScreenshot } from '../game-controls';
import { gameReady } from '../game-controls';
import { waitAbsent } from '../native-state';
import { captureMovingKeyframes } from '../loop-keyframes';
import { matchingSpinnerRegion } from '../animation-region';

if (!(!['all', 'guest'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('native launch artwork and staging notice appear on a real app start', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120_000 });
      await device.terminate();
      await device.home();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const start = () => device!.launch();
      await captureNativeTransition(device, 'native-launch-and-staging-notice', testInfo,
        { x: 0, y: 0, ...device.screenSize }, start, [], [], 1500, 'launchFrames',
        async (frames, info) => {
          const dialog = stagingCardBounds(await device!.nodes(), device!.screenSize);
          const brand = await device!.marker('launch-brand-name');
          // iOS may hide background accessibility nodes while a modal is active.
          // In that case omit the area above the actual dialog, which contains the
          // brand text, and match the still-visible forest sides and water below.
          const brandBounds = brand?.bounds ?? { x: 0, y: 0, width: device!.screenSize.width, height: dialog.y };
          await verifyLaunchArtwork(frames, info, [dialog, brandBounds]);
        }, () => device!.wait({ res: 'staging-confirmation-input' }, { timeout: 120_000 }));
      await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120_000 });
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  });
});

if (!(!['all', 'account'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('native account stack slides in and out', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      await tap(device, 'settings-tab');
      await reveal(device, { res: 'account-security' });
      const entry = await device.info({ res: 'account-security' });
      // 底部导航自身的头像动画在页面切换前后持续播放，采样区域止于导航上方。
      const tab = await device.info({ res: 'settings-tab' });
      const region = { x: 0, y: 0, width: device.screenSize.width, height: tab.bounds.y };
      /** 点击真实账号安全入口，采集 iOS 原生水平入栈轨迹。 */
      const enter = () => device!.input.tap({ x: Number(String(Math.round(entry.bounds.x + entry.bounds.width / 2))), y: Number(String(Math.round(entry.bounds.y + entry.bounds.height / 2))) });
      await captureNativeTransition(device, 'native-stack-enter', testInfo, region, enter,
        [], [], 0, 'videoFrames');
      await gameReady(device, 'account-security-items-list');
      /** 系统返回调用当前导航栈的水平出栈动画。 */
      const exit = () => device!.input.press('Back');
      await captureNativeTransition(device, 'native-stack-exit', testInfo, region, exit);
      await gameReady(device, 'account-security');
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  });
});

if (!(!['all', 'guest'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('guest search confirmation animates into and out of the iOS screen', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      device.nativeVideoBackend = 'xctest';
      await waitForHall(device);
      const entrance = await device.info({ res: 'hall-search-button' });
      /** 通过 XCUITest 触发按钮，使 Simulator 同时录制屏幕。 */
      const pressSearch = () => device!.input.tap({ x: Number(String(Math.round(entrance.bounds.x + entrance.bounds.width / 2))), y: Number(String(Math.round(entrance.bounds.y + entrance.bounds.height / 2))) });
      const region = screenBounds(device, { x: 58, y: 495, width: 604, height: 345 });
      await captureNativeTransition(device, 'search-confirmation-enter', testInfo, region,
        pressSearch, [], [], 0, 'videoFrames', undefined, undefined,
        ['search-confirmation-enter-middle-alt.png']);
      await device.wait({ res: 'pop-up-message-text', text: 'Please sign in to use search' });
      const cancel = await device.info({ res: 'cancel-button' });
      expect(cancel.bounds.width).toBeGreaterThan(0);
      /** 点击真实取消按钮，不直接卸载弹窗。 */
      const pressCancel = () => device!.input.tap({ x: Number(String(Math.round(cancel.bounds.x + cancel.bounds.width / 2))), y: Number(String(Math.round(cancel.bounds.y + cancel.bounds.height / 2))) });
      await captureNativeTransition(device, 'search-confirmation-exit', testInfo, region,
        pressCancel, [], [], 0, 'videoFrames');
      await device.wait({ res: 'pop-up-message-text' }, { state: 'gone' });
      await pressSearch();
      await device.wait({ res: 'pop-up-message-text', text: 'Please sign in to use search' });
      await tap(device, 'cancel-button');
      await device.wait({ res: 'pop-up-message-text' }, { state: 'gone' });
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  });
});

if (!(!['all', 'social'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('hall matching spinner animates while the real waiting dialog is visible', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      const hall = androidScenarios('en', 'social').find(scenario => scenario.pageLabel === 'signed_in_hall');
      expect(hall).toBeDefined();
      await navigateScenario(device, hall!);
      const masks = await screenshotMasks(device, hall!);
      await tap(device, 'match-game-item-texas_holdem-tourists');
      await device.wait({ res: 'game-matching-loading-view' });
      const nodes = await device.nodes();
      const countdown = nodes.find(node => node.res === 'game-matching-countdown-text')!;
      const spinner = matchingSpinnerRegion(nodes, device.screenSize);
      await testInfo.attach('hall-matching-spinner-native-region', {
        body: JSON.stringify(spinner), contentType: 'application/json',
      });
      masks.push({ ...countdown.bounds, x: countdown.bounds.x - 4, width: countdown.bounds.width + 8,
        reason: '匹配计时数字' }, { ...spinner, reason: '匹配图标旋转范围' });
      /** 保留原生匹配窗口实际绘制的每一帧。 */
      const capture = () => gameScreenshot(device!);
      await verifyLoopAnimation(device, 'en-hall-matching', testInfo, [spinner], masks,
        { takeScreenshot: capture, timeoutMs: 4_000 });
      await captureMovingKeyframes(device, 'hall-matching-spinner', testInfo,
        [spinner], 2);
      await compareScreenshot(device, 'en-hall-matching', testInfo, masks, undefined, capture);
      await tap(device, 'quick-start-room-cancel');
      await waitAbsent(device, { res: 'game-matching-loading-view' });
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  }, false, true);
});

if (!(!['all', 'social'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('club more menu fades into and out of the iOS screen', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      const club = androidScenarios('en', 'social').find(scenario => scenario.pageLabel === 'signed_in_club');
      expect(club).toBeDefined();
      await navigateScenario(device, club!);
      const more = await device.info({ res: 'show-more-button' });
      /** 点击俱乐部真实菜单入口。 */
      const pressMore = () => device!.input.tap({ x: Number(String(Math.round(more.bounds.x + more.bounds.width / 2))), y: Number(String(Math.round(more.bounds.y + more.bounds.height / 2))) });
      const region = screenBounds(device, { x: 446, y: 170, width: 250, height: 250 });
      await captureNativeTransition(device, 'club-more-enter', testInfo, region, pressMore, [], [], 800);
      await device.wait({ res: 'popup-content-container' });
      await device.wait({ res: 'popup-backdrop', text: /Create Club, Search Club, Scan/ });
      /** 点击菜单外的真实遮罩关闭弹层。 */
      const pressBackdrop = () => device!.input.tap(screenPoint(device!, 300, 300));
      await captureNativeTransition(device, 'club-more-exit', testInfo, region, pressBackdrop, [], [], 800);
      await device.wait({ res: 'popup-content-container' }, { state: 'gone' });
      const roomsTab = await device.info({ res: 'club_tab_room' });
      /** 从我的俱乐部切换到牌局空态。 */
      const pressRoomsTab = () => device!.input.tap({ x: Number(String(Math.round(roomsTab.bounds.x + roomsTab.bounds.width / 2))), y: Number(String(Math.round(roomsTab.bounds.y + roomsTab.bounds.height / 2))) });
      await captureNativeTransition(device, 'club-rooms-empty-enter', testInfo,
        screenBounds(device, { x: 100, y: 420, width: 520, height: 200 }), pressRoomsTab);
      await device.wait({ res: 'club-rooms-empty-title' });
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  });
});

if (!(!['all', 'rooms'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('private room game picker slides into and out of the iOS screen', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      device.nativeVideoBackend = 'xctest';
      await waitForHall(device);
      await signIn(device);
      const detail = androidScenarios('en', 'rooms').find(scenario => scenario.pageLabel === 'signed_in_private_room_detail');
      expect(detail).toBeDefined();
      await navigateScenario(device, detail!);
      const button = await device.info({ res: 'create-game-button' });
      /** 通过真实建房入口打开选玩法抽屉。 */
      const pressCreate = () => device!.input.tap({ x: Number(String(Math.round(button.bounds.x + button.bounds.width / 2))), y: Number(String(Math.round(button.bounds.y + button.bounds.height / 2))) });
      const region = screenBounds(device, { x: 0, y: 632, width: 720, height: 648 });
      await captureNativeTransition(device, 'game-picker-enter', testInfo, region, pressCreate);
      await device.wait({ res: 'select-game-category-text' });
      // iOS's navigation Back gesture leaves this modal open. Dismiss through
      // its real backdrop, above the handle rather than inside the drawer.
      const backdrop = await device.info({ clazz: 'XCUIElementTypeButton', text: 'Bottom sheet backdrop' });
      const handle = await device.info({ text: 'Bottom sheet handle' });
      const top = Math.max(0, backdrop.bounds.y);
      expect(handle.bounds.y, '抽屉上方必须有可点击遮罩').toBeGreaterThan(top);
      const dismiss = { x: backdrop.bounds.x + backdrop.bounds.width / 2, y: (top + handle.bounds.y) / 2 };
      const pressBackdrop = () => device!.input.tap(dismiss);
      await captureNativeTransition(device, 'game-picker-exit', testInfo, region, pressBackdrop,
        [], [], 0, 'videoFrames', undefined,
        () => device!.wait({ res: 'select-game-category-text' }, { state: 'gone' }));
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  });
});

if (!(!['all', 'rooms'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('private room invite sheet slides into and out of the iOS screen', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async () => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      // 私人房标签直接呈现当前房间详情；建房入口会进入空房页面。
      await tap(device, 'private-room-tab');
      // 首次进入会显示“邀请好友”新手引导，先通过真实完成按钮关闭。
      await reveal(device, { res: 'copy-house-number-button' });
      try { await gameReady(device, 'copy-house-number-button'); }
      catch (error) {
        await testInfo.attach('invite-entry-screen', { body: await gameScreenshot(device), contentType: 'image/png' });
        throw error;
      }
      const button = await gameReady(device, 'invite-friends-button');
      await new Promise(resolve => setTimeout(resolve, 800));
      /** 从私人房详情的实际按钮打开分享应用抽屉。 */
      const pressInvite = () => device!.input.tap({ x: Number(String(Math.round(button.bounds.x + button.bounds.width / 2))), y: Number(String(Math.round(button.bounds.y + button.bounds.height / 2))) });
      const region = screenBounds(device, { x: 0, y: 820, width: 720, height: 460 });
      await captureNativeTransition(device, 'invite-friends-enter', testInfo, region, pressInvite);
      const cancel = await gameReady(device, 'invite-friend-popup-cancel-button');
      expect(cancel.bounds.width).toBeGreaterThan(0);
      /** 通过抽屉中的取消按钮触发同一组件的退场动画。 */
      const pressCancel = () => device!.input.tap({ x: Number(String(Math.round(cancel.bounds.x + cancel.bounds.width / 2))), y: Number(String(Math.round(cancel.bounds.y + cancel.bounds.height / 2))) });
      await captureNativeTransition(device, 'invite-friends-exit', testInfo, region, pressCancel);
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  }, false, false, false, false, true);
});
