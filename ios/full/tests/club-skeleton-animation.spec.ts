import { captureFailure } from '../diagnostics';
import { expect, test } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from '../native-device';
import { launchApplication, waitForHall } from '../device';
import { withAndroidProxy } from '../proxy';
import { signIn } from '../navigation';
import { gameNodes } from '../game-controls';
import { captureLoopKeyframes } from '../loop-keyframes';
import { recordScreenSamples } from '../video-frames';
import type { ScreenshotBounds } from '../screenshot';

if (!(!['all', 'social'].includes(process.env.IOS_GROUP || 'all')
    || (process.env.IOS_LOCALE || 'en') !== 'en')) test('every native club placeholder pulses while detail response is pending', async ({}, testInfo) => {

  test.setTimeout(1_200_000);
  await withAndroidProxy(async proxy => {
    let device: AndroidDevice | undefined;
    try {
      device = await launchApplication({ gameDriver: true, enableSystemAnimations: true });
      device.nativeVideoBackend = 'xctest';
      await waitForHall(device);
      await signIn(device);
      await expect.poll(async () => (await proxy.command<{ loaded: number }>('android/skeleton')).loaded,
        { timeout: 60_000 }).toBeGreaterThan(0);
      const initial = (await proxy.command<{ loaded: number }>('android/skeleton')).loaded;
      // 在挂起俱乐部响应前读取入口；原生点击不会等待网络进入 idle，给骨架动画留下完整采样窗口。
      const tab = (await device.info({ res: 'club-tab' })).bounds;
      await proxy.command('android/skeleton', { hold: true });
      await device.input.tap({ x: Number(String(Math.round(tab.x + tab.width / 2))), y: Number(String(Math.round(tab.y + tab.height / 2))) });
      let regions: ScreenshotBounds[] = [];
      // One native-tree observation, rather than wait() plus a second slow tree.
      await expect(async () => {
        const nodes = await gameNodes(device!);
        const placeholders = nodes.filter(node => node.res === 'ClubItemPlaceholder_container' && node.bounds.width > 0);
        expect(placeholders, '两个真实俱乐部 ID 都应绘出各自的骨架').toHaveLength(2);
        expect(nodes.filter(node => node.res === 'club-title'), '挂起响应时不能已显示俱乐部内容').toHaveLength(0);
        expect(nodes.some(node => /network issue/i.test(node.text || '')), '采样前不能已进入超时错误页').toBe(false);
        regions = placeholders.map(node => node.bounds);
      }).toPass({ timeout: 30_000, intervals: [200] });
      const samples = await recordScreenSamples(device, 'club-list-skeleton', testInfo, () => {}, 3500,
        async () => { await proxy.command('android/skeleton', { hold: false }); });
      await captureLoopKeyframes(device, 'club-list-skeleton', testInfo, regions, 1, samples);
      await expect.poll(async () => (await proxy.command<{ loaded: number }>('android/skeleton')).loaded,
        { timeout: 30_000 }).toBeGreaterThan(initial);
      // The native card keeps its Placeholder_container testID after loading.
      // Require both actual fixture titles instead of waiting for that wrapper.
      await expect.poll(async () => (await gameNodes(device!)).filter(node => node.res === 'club-title')
        .map(node => node.text).sort(), { timeout: 30_000 }).toEqual(['TestClub1', 'TestClub2']);
    } catch (error) {
      if (device) await captureFailure(device, testInfo);
      throw error;
    } finally {
      await proxy.command('android/skeleton', { hold: false }).catch(() => {});
      await device?.close();
    }
  }, false, false, false, true);
});
