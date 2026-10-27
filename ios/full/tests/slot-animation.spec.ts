import { captureFailure } from '../diagnostics';
import { assertVisual } from '../device';
import { baselinePath } from '../baseline-path.mjs';
import { screenBounds } from '../screen-geometry';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NativeDevice as AndroidDevice } from '../native-device';
import { launchApplication, waitForHall, simulatorAppPath } from '../device';
import { withAndroidProxy } from '../proxy';
import { signIn, navigateScenario } from '../navigation';
import { androidScenarios } from '../scenarios';
import { captureNativeTransition } from '../animation-transition';
import { verifyLoopAnimation } from '../loop-animation';
import { captureMovingKeyframes } from '../loop-keyframes';
import { waitAbsent } from '../native-state';
import { gameReady, gameScreenshot } from '../game-controls';
import { cropMotionRegion, samePixels } from '../motion-regions';
import { slotBannerSpinPoint, slotNoEnergyImage, slotNoEnergyRegions, slotReelRegions } from '../slot-regions';
import { slotBackgroundMasks, slotHeadReference, verifySlotHeadGeometry } from '../slot-background';
import { animationRecordOnly } from '../record-only';
import { pressVerifiedSlotSpin } from '../slot-spin';

if (!(!['all', 'social'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('all three native slot reels and reward types animate from real spin responses', async ({}, testInfo) => {

  // Seven independent native transitions plus login and loop recordings.
  test.setTimeout(2_700_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      device.nativeVideoBackend = 'xctest';
      await waitForHall(device);
      await signIn(device);
      const scenario = androidScenarios('en', 'social').find(item => item.pageLabel === 'signed_in_hall');
      expect(scenario).toBeDefined();
      await navigateScenario(device, scenario!);
      const banner = await device.info({ res: 'slot-banner' });
      const bannerMotion = { x: Math.floor(banner.bounds.x + banner.bounds.width * 0.52),
        y: Math.floor(banner.bounds.y + banner.bounds.height * 0.16),
        width: Math.floor(banner.bounds.width * 0.4), height: Math.floor(banner.bounds.height * 0.48) };
      const backgroundBannerMasks = [{ ...bannerMotion,
        reason: '仅弹层前/后大厅端点的横幅轮播；同例独立验证横幅运动和两种基准相位' }];
      const exposedBannerMasks = animationRecordOnly ? [] : slotBackgroundMasks(
        readFileSync(join(await simulatorAppPath(), slotHeadReference.asset)), bannerMotion);
      await verifyLoopAnimation(device, 'hall-slot-banner', testInfo, [bannerMotion], [], { timeoutMs: 8000 });
      await captureMovingKeyframes(device, 'hall-slot-banner', testInfo, [bannerMotion], 32, undefined, 5);
      /** 从登录大厅的真实横幅打开老虎机窗口。 */
      const pressBanner = () => device!.input.tap(slotBannerSpinPoint(banner.bounds));
      await captureNativeTransition(device, 'slot-popup-enter', testInfo,
        screenBounds(device, { x: 0, y: 500, width: 720, height: 680 }), pressBanner, [], [], 0, 'videoFrames',
        undefined, undefined, ['slot-popup-enter-background.png', 'slot-popup-enter-overlap.png',
          'slot-popup-enter-reels-blank.png'], [], exposedBannerMasks, [], backgroundBannerMasks,
        undefined, async () => {
          // Querying the full native tree during this short entrance can stall
          // XCTest video delivery. Validate before pixel comparison, after stop.
          await expect(async () => {
            const nodes = await device!.nodes();
            verifySlotHeadGeometry(nodes);
            expect(nodes.some(node => node.res === 'spin-button' && node.enabled)).toBe(true);
          }).toPass({ timeout: 30_000, intervals: [250] });
        });
      await device.wait({ res: 'spin-button' });
      const { window: reelWindow, reels } = slotReelRegions(await device.nodes());
      await testInfo.attach('slot-native-reel-regions', {
        body: JSON.stringify({ window: reelWindow, reels }), contentType: 'application/json',
      });
      for (const [currency, reward] of [
        ['coin', 'prize_coin_text_animation_text'],
        ['currency_diamond', 'prize_diamond_text_animation_text'],
        ['energy', 'prize_energy_text_animation_text'],
      ] as const) {
        await proxy.command('android/slot', { currency });
        const button = await device.info({ res: 'spin-button' });
        /** 点击正式老虎机的旋转按钮，网络夹具只固定奖励响应。 */
        const pressSpin = () => device!.input.tap({ x: Number(String(Math.round(button.bounds.x + button.bounds.width / 2))), y: Number(String(Math.round(button.bounds.y + button.bounds.height / 2))) });
        await captureNativeTransition(device, `slot-${currency}-reels`, testInfo,
          reelWindow, pressSpin, [], reels, 1500);
        const prize = await device.info({ res: reward });
        expect(Number(prize.text), `${currency} 应显示真实奖励`).toBeGreaterThan(0);
      }
      const status = await proxy.command<{ spins: number }>('android/slot');
      expect(status.spins, '三种奖励必须分别由真实旋转 RPC 触发').toBe(3);
      const close = await gameReady(device, 'close-button');
      /** 正常关闭老虎机，采集面板退场。能量不足会自动关闭面板，无法再点击该按钮。 */
      const pressClose = () => device!.input.tap({ x: Number(String(Math.round(close.bounds.x + close.bounds.width / 2))), y: Number(String(Math.round(close.bounds.y + close.bounds.height / 2))) });
      await captureNativeTransition(device, 'slot-popup-exit', testInfo,
        screenBounds(device, { x: 0, y: 500, width: 720, height: 680 }), pressClose, [], [], 0, 'videoFrames',
        undefined, undefined, [], [], backgroundBannerMasks, [], exposedBannerMasks);
      await waitAbsent(device, { res: 'spin-button' });
      const bannerAgain = await device.info({ res: 'slot-banner' });
      await device.input.tap(slotBannerSpinPoint(bannerAgain.bounds));
      await device.wait({ res: 'spin-button' });
      // 控件树在弹层入场中途已出现；等不受滚轮图案影响的左边框停止移动后再点击。
      const reopened = slotReelRegions(await device.nodes());
      const noEnergyRegion = { ...reopened.window, width: reopened.reels[0].x - reopened.window.x };
      expect(noEnergyRegion.width, '滚轮裁剪窗口左侧应有独立静态边框').toBeGreaterThan(0);
      /** 只采集不会受滚轮随机停靠图案影响的弹层左边框。 */
      const border = async () => cropMotionRegion(await gameScreenshot(device!), noEnergyRegion);
      let stableBorder = await border();
      let stableSince = Date.now();
      await expect(async () => {
        const current = await border();
        if (!samePixels(current, stableBorder)) { stableBorder = current; stableSince = Date.now(); }
        expect(Date.now() - stableSince).toBeGreaterThanOrEqual(600);
      }).toPass({ timeout: 10_000, intervals: [150] });
      await proxy.command('android/slot', { currency: 'coin', noEnergy: true });
      /** 真实能量不足旋转请求触发老虎机窗口切换到专用提示。 */
      const pressEmptySpin = () => pressVerifiedSlotSpin(device!, async () =>
        (await proxy.command<{ spins: number }>('android/slot')).spins, status.spins);
      // 左侧边框不受每次打开时滚轮随机停靠图案影响；完整提示另做逐像素基准。
      await captureNativeTransition(device, 'slot-no-energy-enter', testInfo, noEnergyRegion, pressEmptySpin,
        [], [], 0, 'videoFrames', undefined, async () => {
          await device!.wait({ res: slotNoEnergyImage });
          await device!.wait({ res: 'confirm-button' });
        });
      const prompt = slotNoEnergyRegions(await device.nodes(), device.screenSize);
      const promptImage = cropMotionRegion(await gameScreenshot(device), prompt.full);
      await testInfo.attach('slot-no-energy-visible', { body: promptImage, contentType: 'image/png' });
      if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(promptImage, 'slot-no-energy-visible.png', testInfo);
      else expect(samePixels(promptImage, readFileSync(baselinePath('slot-no-energy-visible.png'))),
        '能量不足提示完整画面视觉回归').toBe(true);
      const confirm = await device.info({ res: 'confirm-button' });
      /** 通过真实确认按钮关闭能量不足提示。 */
      const pressConfirm = () => device!.input.tap({ x: Number(String(Math.round(confirm.bounds.x + confirm.bounds.width / 2))), y: Number(String(Math.round(confirm.bounds.y + confirm.bounds.height / 2))) });
      // 39886064246 的合成器录像从提示起点跳到末尾，只留下过近的两帧。
      device.nativeVideoBackend = 'xctest';
      await captureNativeTransition(device, 'slot-no-energy-exit', testInfo, noEnergyRegion, pressConfirm,
        [], [], 0, 'videoFrames', undefined, async () => {
          await device!.wait({ res: slotNoEnergyImage }, { state: 'gone' });
          await device!.wait({ res: 'confirm-button' }, { state: 'gone' });
        });
      const final = await proxy.command<{ spins: number }>('android/slot');
      expect(final.spins, '能量不足由第四次旋转请求触发').toBe(4);
      await waitAbsent(device, { res: 'spin-button' });
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally { await device?.close(); }
  }, false, false, true);
});
