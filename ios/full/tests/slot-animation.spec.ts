import { assertVisual } from '../device';
import { baselinePath } from '../baseline-path.mjs';
import { screenBounds } from '../screen-geometry';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { NativeDevice as AndroidDevice } from '../native-device';
import { launchApplication, waitForHall } from '../device';
import { withAndroidProxy } from '../proxy';
import { signIn, navigateScenario } from '../navigation';
import { androidScenarios } from '../scenarios';
import { captureNativeTransition } from '../animation-transition';
import { verifyLoopAnimation } from '../loop-animation';
import { captureMovingKeyframes } from '../loop-keyframes';
import { waitAbsent } from '../native-state';
import { gameReady, gameScreenshot } from '../game-controls';
import { motionParts, samePixels } from '../motion-regions';

if (!(!['all', 'social'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('all three native slot reels and reward types animate from real spin responses', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      await waitForHall(device);
      await signIn(device);
      const scenario = androidScenarios('en', 'social').find(item => item.pageLabel === 'signed_in_hall');
      expect(scenario).toBeDefined();
      await navigateScenario(device, scenario!);
      const banner = await device.info({ res: 'slot-banner' });
      const bannerMotion = { x: Math.floor(banner.bounds.x + banner.bounds.width * 0.52),
        y: Math.floor(banner.bounds.y + banner.bounds.height * 0.16),
        width: Math.floor(banner.bounds.width * 0.4), height: Math.floor(banner.bounds.height * 0.48) };
      await verifyLoopAnimation(device, 'hall-slot-banner', testInfo, [bannerMotion], [], { timeoutMs: 8000 });
      await captureMovingKeyframes(device, 'hall-slot-banner', testInfo, [bannerMotion], 32, undefined, 5);
      /** 从登录大厅的真实横幅打开老虎机窗口。 */
      const pressBanner = () => device!.input.tap({ x: Number(String(Math.round(banner.bounds.x + banner.bounds.width / 2))), y: Number(String(Math.round(banner.bounds.y + banner.bounds.height / 2))) });
      await captureNativeTransition(device, 'slot-popup-enter', testInfo,
        screenBounds(device, { x: 0, y: 500, width: 720, height: 680 }), pressBanner, [], [], 0, 'videoFrames',
        undefined, undefined, ['slot-popup-enter-background.png', 'slot-popup-enter-overlap.png',
          'slot-popup-enter-reels-blank.png']);
      await device.wait({ res: 'slot-machine-view' });
      const reels = [
        screenBounds(device, { x: 143, y: 420, width: 137, height: 362 }),
        screenBounds(device, { x: 287, y: 420, width: 137, height: 362 }),
        screenBounds(device, { x: 431, y: 420, width: 137, height: 362 }),
      ];
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
          screenBounds(device, { x: 124, y: 420, width: 469, height: 362 }), pressSpin, [], reels, 1500);
        const prize = await device.info({ res: reward });
        expect(Number(prize.text), `${currency} 应显示真实奖励`).toBeGreaterThan(0);
      }
      const status = await proxy.command<{ spins: number }>('android/slot');
      expect(status.spins, '三种奖励必须分别由真实旋转 RPC 触发').toBe(3);
      const close = await gameReady(device, 'close-button');
      /** 正常关闭老虎机，采集面板退场。能量不足会自动关闭面板，无法再点击该按钮。 */
      const pressClose = () => device!.input.tap({ x: Number(String(Math.round(close.bounds.x + close.bounds.width / 2))), y: Number(String(Math.round(close.bounds.y + close.bounds.height / 2))) });
      await captureNativeTransition(device, 'slot-popup-exit', testInfo,
        screenBounds(device, { x: 0, y: 500, width: 720, height: 680 }), pressClose, [], [], 0, 'videoFrames');
      await waitAbsent(device, { res: 'slot-machine-view' });
      const bannerAgain = await device.info({ res: 'slot-banner' });
      await device.input.tap({ x: Number(String(Math.round(bannerAgain.bounds.x + bannerAgain.bounds.width / 2))), y: Number(String(Math.round(bannerAgain.bounds.y + bannerAgain.bounds.height / 2))) });
      await device.wait({ res: 'slot-machine-view' });
      // 控件树在弹层入场中途已出现；等不受滚轮图案影响的左边框停止移动后再点击。
      const noEnergyRegion = screenBounds(device, { x: 80, y: 510, width: 40, height: 380 });
      /** 只采集不会受滚轮随机停靠图案影响的弹层左边框。 */
      const border = async () => motionParts(await gameScreenshot(device!), [noEnergyRegion]).regions[0];
      let stableBorder = await border();
      let stableSince = Date.now();
      await expect(async () => {
        const current = await border();
        if (!samePixels(current, stableBorder)) { stableBorder = current; stableSince = Date.now(); }
        expect(Date.now() - stableSince).toBeGreaterThanOrEqual(600);
      }).toPass({ timeout: 10_000, intervals: [150] });
      await proxy.command('android/slot', { currency: 'coin', noEnergy: true });
      const spin = await device.info({ res: 'spin-button' });
      /** 真实能量不足 RPC 触发老虎机窗口切换到专用提示。 */
      const pressEmptySpin = () => device!.input.tap({ x: Number(String(Math.round(spin.bounds.x + spin.bounds.width / 2))), y: Number(String(Math.round(spin.bounds.y + spin.bounds.height / 2))) });
      // 左侧边框不受每次打开时滚轮随机停靠图案影响；完整提示另做逐像素基准。
      await captureNativeTransition(device, 'slot-no-energy-enter', testInfo, noEnergyRegion, pressEmptySpin);
      const prompt = await device.info({ res: 'slot-no-energy-popup-container' });
      expect(prompt.bounds.width).toBeGreaterThan(0);
      const promptImage = motionParts(await gameScreenshot(device),
        [screenBounds(device, { x: 80, y: 510, width: 560, height: 380 })]).regions[0];
      await testInfo.attach('slot-no-energy-visible', { body: promptImage, contentType: 'image/png' });
      if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(promptImage, 'slot-no-energy-visible.png', testInfo);
      else expect(samePixels(promptImage, readFileSync(baselinePath('slot-no-energy-visible.png'))),
        '能量不足提示完整画面视觉回归').toBe(true);
      const confirm = await device.info({ res: 'confirm-button' });
      /** 通过真实确认按钮关闭能量不足提示。 */
      const pressConfirm = () => device!.input.tap({ x: Number(String(Math.round(confirm.bounds.x + confirm.bounds.width / 2))), y: Number(String(Math.round(confirm.bounds.y + confirm.bounds.height / 2))) });
      await captureNativeTransition(device, 'slot-no-energy-exit', testInfo, noEnergyRegion, pressConfirm,
        [], [], 0, 'videoFrames');
      const final = await proxy.command<{ spins: number }>('android/slot');
      expect(final.spins, '能量不足由第四次旋转请求触发').toBe(4);
      await waitAbsent(device, { res: 'slot-machine-view' });
    } finally { await device?.close(); }
  }, false, false, true);
});
