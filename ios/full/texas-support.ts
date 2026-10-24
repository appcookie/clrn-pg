import { expect, type TestInfo } from '@playwright/test';
import { stableNativeObservation } from './native-stability';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { events, restoreTable, type Street, type TableOptions } from '../../visual/cases/texas-holdem/replayData';
import { gameGone, gameNodes, gameReady, gameTap } from './game-controls';
import { gameCardNames, replay } from './game-replay';
import type { ScreenshotMask } from './screenshot';
import { gameMenu } from './game-pregame';

export type TexasContext = {
  device: AndroidDevice; proxy: Mitmproxy; room: string; self: string;
  animationInfo?: TestInfo;
  capture(state: string, masks?: ScreenshotMask[], triggerToast?: () => Promise<string | void>, heldScreenshot?: Buffer): Promise<void>;
};

/**
 * 复用 Web 消息夹具恢复牌局，等待五个真实牌面容器完成更新。
 * @param context - 当前真实房间及原生连接。
 * @param options - Web 共用的牌桌人数、底池与操作配置。
 * @param street - 要恢复的回合。
 * @param opponent - 是否轮到对手操作。
 */
export async function restoreTexas(context: TexasContext, options: TableOptions = {}, street: Street = 'river', opponent = false): Promise<void> {
  await replay(context.proxy, 'texas', context.room, restoreTable(context.self, street, opponent, options));
  const count = { preflop: 0, flop: 3, turn: 4, river: 5 }[street];
  await gameCardNames(context.device, 'community_card', 'community_card_name_text',
    ['ah', 'kd', '7c', '2s', 'qs'].map((card, index) => index < count ? card : 'back'));
}

/**
 * 将 Web 共用的事件队列发送到本轮真实房间。
 * @param context - 当前真实房间及原生连接。
 * @param queue - 真实游戏协议事件。
 */
export async function texasEvents(context: TexasContext, queue: Record<string, unknown>[]): Promise<void> {
  await replay(context.proxy, 'texas', context.room, events(queue));
}

/**
 * 等待并点击没有独立 testID 的原生文字，位置连续稳定后才输入。
 * @param device - 专用模拟器连接。
 * @param text - 三种语言共用的准确文字模式。
 */
export async function gameTapText(device: AndroidDevice, text: RegExp): Promise<void> {
  const selected = await stableNativeObservation(
    async () => (await gameNodes(device)).filter(node => text.test(node.text || '')).at(-1),
    (before, current) => {
      expect(current, `${text} 应可见`).toBeDefined();
      expect(current!.bounds).toEqual(before?.bounds);
    }, { timeout: 30_000, interval: 250 });
  const { x, y, width, height } = selected!.bounds;
  await device.input.tap({ x: Number(String(Math.round(x + width / 2))), y: Number(String(Math.round(y + height / 2))) });
}

/**
 * 通过实际开关启用牌桌功能，不直接修改组件状态。
 * @param device - 专用模拟器连接。
 * @param setting - 共用的开关后缀。
 */
export async function enableGameSetting(device: AndroidDevice, setting: string): Promise<void> {
  await gameMenu(device, 'settings', 'game-settings-popup-container');
  const marker = `game-settings-switch-${setting}`;
  if (!(await gameReady(device, marker)).checked) await gameTap(device, marker);
  await expect.poll(async () => (await gameReady(device, marker)).checked, { timeout: 30_000 }).toBe(true);
  await gameTap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-popup-container');
}
