import { request, expect } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { ensureRoomBalance, type Account, type RoomSession } from '../../visual/cases/_shared/room';
import { dismissKeyboard } from './keyboard';
import { tap, returnToTabs, reveal } from './navigation';
import { gameReady, gameGone, gameNodes, gameConnectionState } from './game-controls';
import { enterTexasRoom } from '../../visual/cases/texas-holdem/room';
import { setTimeout as delay } from 'node:timers/promises';
import { NetworkObserver, type RoomCreationAttempt } from './network-observer';

/**
 * 从认证的本机控制接口取得本轮真实会话；不将令牌写入日志或报告。
 * @param proxy - 本轮独占代理。
 */
export async function gameSession(proxy: Mitmproxy): Promise<{ account: Account | null; room: RoomSession | null }> {
  return proxy.command('android/session');
}

/** 等待真实建房响应；只有代理确认第一次点击没有发出请求且表单仍可操作，才补点一次。 */
export async function submitGameRoom(device: AndroidDevice, proxy: Mitmproxy,
  press = () => tap(device, 'creat-room-button'),
  waits = { firstMs: 20_000, finalMs: 60_000 }): Promise<RoomSession> {
  const observer = new NetworkObserver(proxy);
  const cursor = await observer.mark();
  const attempts = () => observer.roomCreationAttempts(cursor);
  const waitForRoom = async (timeoutMs: number): Promise<RoomSession | null> => {
    const deadline = Date.now() + timeoutMs;
    do {
      const room = (await gameSession(proxy)).room;
      if (room) return room;
      const current = await attempts();
      const failed = current.find(item => item.completed && (item.status !== 200 || item.ok !== true));
      if (failed) throw new Error(`真实建房请求失败：HTTP ${failed.status}，业务成功标记 ${failed.ok}`
        + `；请求序号 ${failed.sequence}，响应归属 ${failed.responseSource ?? 'unknown'}`
        + `，失败类别 ${failed.failureCategory ?? 'unknown'}，原因 ${failed.failureReason ?? 'unknown'}`);
      if (Date.now() >= deadline) return null;
      await delay(500);
    } while (true);
  };
  await press();
  let room = await waitForRoom(waits.firstMs);
  if (!room && (await attempts()).length === 0) {
    const nodes = await gameNodes(device);
    gameConnectionState(nodes);
    const form = nodes.some(node => node.res === 'base-create-room-screen' && node.visible !== false);
    const button = nodes.find(node => node.res === 'creat-room-button' && node.visible !== false && node.enabled);
    const blocked = nodes.some(node => node.visible !== false && (node.clazz === 'XCUIElementTypeAlert'
      || /^(?:common-alert-title|common-alert-message|alert-message-text|popup-content-container)$/.test(node.res || '')));
    if (!form || !button || blocked) throw new Error('建房点击后没有请求，表单或按钮已变化，禁止重复提交');
    // 原生树读取期间仍可能发出请求；补点前再次确认代理没有接收第一次提交。
    if ((await attempts()).length === 0) await press();
  }
  room ??= await waitForRoom(waits.finalMs);
  if (!room) {
    const current: RoomCreationAttempt[] = await attempts();
    throw new Error(current.length ? '真实建房请求已发出，但未登记成功房间，禁止重复提交'
      : '两次真实点击均未发出建房请求');
  }
  return room;
}

/** 房规读取超时发生在建房请求之前；仅对已确认的只读加载错误重新进入表单一次。 */
export async function openGameRoomForm(device: AndroidDevice, gameButton: string,
  selectGame = () => tap(device, gameButton),
  reopenPicker = () => tap(device, 'create-game-button')): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await selectGame();
    try { await device.wait({ res: 'room-name-input' }); return; }
    catch (error) {
      if (attempt || (error as { code?: string }).code !== 'no such element') throw error;
      const alert = await device.nodes();
      const timedOut = alert.some(node => node.clazz === 'XCUIElementTypeAlert' && node.text === 'Notice')
        && alert.some(node => node.clazz === 'XCUIElementTypeStaticText'
          && node.text === 'timeout of 10000ms exceeded')
        && alert.some(node => node.clazz === 'XCUIElementTypeButton' && node.text === 'OK');
      if (!timedOut) throw error;
      await device.acceptAlert();
      await device.wait({ clazz: 'XCUIElementTypeAlert' }, { state: 'gone' });
      const loading = await device.nodes();
      if (loading.some(node => node.res === 'room-name-input')) return;
      if (!loading.some(node => node.res === 'create-room-loading-text'
        && node.text === 'Loading room rules, please wait')
        || loading.some(node => node.res === 'creat-room-button')) {
        throw new Error('建房规则超时后页面状态不符，停止重新进入表单');
      }
      await device.input.press('Back', loading);
      await device.wait({ res: 'create-room-loading-container' }, { state: 'gone' });
      const previous = await device.nodes();
      if (previous.some(node => node.res === 'select-game-category-text')) continue;
      if (!previous.some(node => node.res === 'create-game-button')) {
        throw new Error('建房规则超时后未返回游戏选择入口，停止重新进入表单');
      }
      await reopenPicker();
      await device.wait({ res: 'select-game-category-text' });
    }
  }
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
  await openGameRoomForm(device, `game-type-button-${game === 'texas-holdem' ? 'texas_react_native' : game}`);
  await device.fill({ res: 'room-name-input' }, 'TestRoom', { replaceBySelection: true });
  await dismissKeyboard(device);
  if (optionalFeatures) {
    await tap(device, 'advanced-options-button');
    await tap(device, 'BlindsEnableFlipSwitch');
  }
  const room = await submitGameRoom(device, proxy);
  onCreated(room);
  if (view !== 'private') {
    const observerApi = await request.newContext();
    try { await enterTexasRoom({ request: observerApi }, room); }
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
  return room;
}
