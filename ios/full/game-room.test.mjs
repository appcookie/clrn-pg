import test from 'node:test';
import assert from 'node:assert/strict';
import { submitGameRoom } from './game-room.ts';

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
