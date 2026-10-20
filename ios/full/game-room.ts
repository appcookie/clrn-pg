import { request, expect } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { ensureRoomBalance, type Account, type RoomSession } from '../../visual/cases/_shared/room';
import { dismissKeyboard } from './keyboard';
import { tap, returnToTabs, reveal } from './navigation';
import { gameReady, gameGone, gameNodes } from './game-controls';
import { enterTexasRoom } from '../../visual/cases/texas-holdem/room';

/**
 * 从认证的本机控制接口取得本轮真实会话；不将令牌写入日志或报告。
 * @param proxy - 本轮独占代理。
 */
export async function gameSession(proxy: Mitmproxy): Promise<{ account: Account | null; room: RoomSession | null }> {
  return proxy.command('android/session');
}

/**
 * 共用 Web 的余额验证，通过原生表单创建本例私人房，立即登记以便失败时清理。
 * @param device - 专用模拟器连接。
 * @param proxy - 本轮独占代理。
 * @param game - 本轮玩法。
 * @param onCreated - 新房间登记回调。
 * @param optionalFeatures - 与 Web 一致，从真实建房表单启用升盲。
 * @param view - 大厅或非房主展示建立当前私人房的真实观察者连接，并校验对应桌面名称。
 */
export async function createGameRoom(device: AndroidDevice, proxy: Mitmproxy,
  game: 'texas-holdem' | 'zhajinhua', onCreated: (room: RoomSession) => void, optionalFeatures = false,
  view: 'private' | 'hall' | 'guest' = 'private'): Promise<RoomSession> {
  const { account } = await gameSession(proxy);
  if (!account || account.username !== process.env.VISUAL_USERNAME) throw new Error('建房必须使用本轮真实登录的测试账号。');
  const api = await request.newContext();
  try { await ensureRoomBalance(api, account); }
  finally { await api.dispose(); }
  await returnToTabs(device);
  await tap(device, 'private-room-tab');
  await reveal(device, { res: 'copy-house-number-button' });
  await tap(device, 'create-game-button');
  await reveal(device, { res: 'select-game-category-text' });
  await tap(device, `game-type-button-${game === 'texas-holdem' ? 'texas_react_native' : game}`);
  await device.wait({ res: 'room-name-input' });
  await device.fill({ res: 'room-name-input' }, 'TestRoom', { replaceBySelection: true });
  await dismissKeyboard(device);
  if (optionalFeatures) {
    await tap(device, 'advanced-options-button');
    await tap(device, 'BlindsEnableFlipSwitch');
  }
  await tap(device, 'creat-room-button');
  let room: RoomSession | null = null;
  await expect(async () => {
    room = (await gameSession(proxy)).room;
    expect(room, '真实建房接口必须返回本轮新建的房间').not.toBeNull();
  }).toPass({ timeout: 60_000, intervals: [500] });
  onCreated(room!);
  if (view !== 'private') {
    const observerApi = await request.newContext();
    try { await enterTexasRoom({ request: observerApi }, room!); }
    finally { await observerApi.dispose(); }
  }
  // XCUITest marks the non-accessible outer game view hidden even while its
  // native menu and room label are visible. Require those actual controls.
  await gameGone(device, 'game-splash-screen-bg');
  await gameReady(device, 'menu-button');
  const hallNames: Record<string, string> = { en: 'Hall', 'zh-Hans': '大厅', 'zh-Hant': '大廳' };
  const roomName = view === 'hall' ? hallNames[process.env.IOS_LOCALE || 'en'] : 'TestRoom';
  if (!roomName) throw new Error('缺少当前语言的大厅牌桌名称断言。');
  await gameReady(device, game === 'texas-holdem' ? 'texas-holdem-room-name-text' : 'zhajinhua-text-room-name', roomName);
  if (game === 'zhajinhua') {
    // 菜单比真实初始桌况更早挂载；完整九个座位就绪后才能发送牌局回放。
    await expect.poll(async () => (await gameNodes(device)).filter(node => /^zhajinhua-seat-[1-9]$/.test(node.res || '')).length,
      { timeout: 45_000 }).toBe(9);
    await gameReady(device, 'zhajinhua-text-room-name', 'TestRoom');
  }
  return room!;
}
