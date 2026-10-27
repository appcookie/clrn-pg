import test from 'node:test';
import assert from 'node:assert/strict';
import { openGameRoomForm, submitGameRoom } from './game-room.ts';

const bounds = { x: 10, y: 10, width: 40, height: 40 };
const form = { res: 'base-create-room-screen', bounds, visible: true, enabled: true };
const button = { res: 'creat-room-button', bounds, visible: true, enabled: true };
const room = { roomId: '20000000-0000-0000-0000-000000000001' };

function fixture(first) {
  let presses = 0;
  const attempts = [];
  let currentRoom = null;
  const proxy = { command: async path => {
    if (path === 'native/observer/mark') return { sequence: 0 };
    if (path === 'native/observer/room-creation') return { attempts };
    if (path === 'android/session') return { room: currentRoom };
    throw new Error(`未预期的控制路径：${path}`);
  } };
  const device = { screenSize: { width: 100, height: 100 }, nodes: async () => first === 'blocked'
    ? [form, button, { res: 'common-alert-title', text: '建房失败', bounds, visible: true }] : [form, button] };
  const press = async () => {
    presses++;
    if (presses === 1 && first === 'pending')
      attempts.push({ sequence: 1, completed: false, status: null, ok: null });
    if (presses === 1 && first === 'failed')
      attempts.push({ sequence: 1, completed: true, status: 503, ok: false });
    if (presses === 1 && first === 'succeeded') currentRoom = room;
    if (presses === 2) currentRoom = room;
  };
  return { device, proxy, press, presses: () => presses };
}

test('首次点击未发出建房请求且原表单仍可操作时只补点一次', async () => {
  const value = fixture('missing');
  assert.deepEqual(await submitGameRoom(value.device, value.proxy, value.press,
    { firstMs: 0, finalMs: 0 }), room);
  assert.equal(value.presses(), 2);
});

test('建房请求待响应或已失败时不得重复提交', async () => {
  for (const state of ['pending', 'failed']) {
    const value = fixture(state);
    await assert.rejects(submitGameRoom(value.device, value.proxy, value.press,
      { firstMs: 0, finalMs: 0 }), /已发出|HTTP 503/);
    assert.equal(value.presses(), 1, '不得重复可能已经生效的建房请求');
  }
});

test('建房表单出现错误弹窗时不补点', async () => {
  const value = fixture('blocked');
  await assert.rejects(submitGameRoom(value.device, value.proxy, value.press,
    { firstMs: 0, finalMs: 0 }), /禁止重复提交/);
  assert.equal(value.presses(), 1);
});

test('首次建房成功时不补点', async () => {
  const value = fixture('succeeded');
  assert.deepEqual(await submitGameRoom(value.device, value.proxy, value.press,
    { firstMs: 0, finalMs: 0 }), room);
  assert.equal(value.presses(), 1);
});

function rulesFixture(kind) {
  let stage = 'picker';
  let selections = 0;
  let dismissals = 0;
  let returns = 0;
  let reopens = 0;
  const nodes = () => {
    if (stage === 'alert') return [
      { clazz: 'XCUIElementTypeAlert', text: 'Notice' },
      { clazz: 'XCUIElementTypeStaticText', text: kind === 'other-alert' ? '其他错误' : 'timeout of 10000ms exceeded' },
      { clazz: 'XCUIElementTypeButton', text: 'OK' },
    ];
    if (stage === 'loading') return kind === 'wrong-page' ? [{ res: 'other-screen' }] : [
      { res: 'create-room-loading-container' },
      { res: 'create-room-loading-text', text: 'Loading room rules, please wait' },
      { res: 'navigation-bar-back-button' },
    ];
    if (stage === 'private') return [{ res: 'create-game-button' }];
    if (stage === 'picker') return [{ res: 'select-game-category-text' }];
    return [{ res: 'room-name-input' }, { res: 'creat-room-button' }];
  };
  const device = {
    nodes: async () => nodes(),
    wait: async (selector, options = {}) => {
      const found = nodes().some(node => Object.entries(selector).every(([key, value]) => node[key] === value));
      if (options.state === 'gone' ? !found : found) return;
      throw Object.assign(new Error('原生控件未出现'), { code: 'no such element' });
    },
    acceptAlert: async () => { dismissals++; stage = 'loading'; },
    input: { press: async key => { assert.equal(key, 'Back'); returns++; stage = 'private'; } },
  };
  const select = async () => { selections++; stage = selections === 1 || kind === 'persistent' ? 'alert' : 'form'; };
  const reopen = async () => { reopens++; stage = 'picker'; };
  return { device, select, reopen, counts: () => ({ selections, dismissals, returns, reopens }) };
}

test('建房规则读取超时且仍在加载页时，只重新进入一次只读表单', async () => {
  const value = rulesFixture('timeout');
  await openGameRoomForm(value.device, 'game-type-button-zhajinhua', value.select, value.reopen);
  assert.deepEqual(value.counts(), { selections: 2, dismissals: 1, returns: 1, reopens: 1 });
});

test('其他错误弹窗不能触发建房规则重试', async () => {
  const value = rulesFixture('other-alert');
  await assert.rejects(openGameRoomForm(value.device, 'game-type-button-zhajinhua', value.select, value.reopen),
    /原生控件未出现/);
  assert.deepEqual(value.counts(), { selections: 1, dismissals: 0, returns: 0, reopens: 0 });
});

test('重进后仍超时，不得第三次选择游戏或关闭第二个错误弹窗', async () => {
  const value = rulesFixture('persistent');
  await assert.rejects(openGameRoomForm(value.device, 'game-type-button-zhajinhua', value.select, value.reopen),
    /原生控件未出现/);
  assert.deepEqual(value.counts(), { selections: 2, dismissals: 1, returns: 1, reopens: 1 });
});

test('关闭超时弹窗后页面不再显示房规加载，禁止重进', async () => {
  const value = rulesFixture('wrong-page');
  await assert.rejects(openGameRoomForm(value.device, 'game-type-button-zhajinhua', value.select, value.reopen),
    /页面状态不符/);
  assert.deepEqual(value.counts(), { selections: 1, dismissals: 1, returns: 0, reopens: 0 });
});
