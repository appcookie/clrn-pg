import test from 'node:test';
import assert from 'node:assert/strict';
import { chatEndpointNodes } from './chat-readiness.ts';
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const panel = node(undefined, { x: 0, y: 1803, width: 1178, height: 753 });
const controls = [node('in-game-chat-send-message', { x: 926, y: 1845, width: 211, height: 135 }),
  node('-in-game-chat-record-tab', { x: 389, y: 2004, width: 178, height: 153 }),
  node('in-game-chat-content-container', { x: 41, y: 2139, width: 1096, height: 381 })];
test('聊天终点等待完整原生内容，返回实际通过检查的那一次树', async () => {
  let reads = 0;
  const complete = [panel, ...controls];
  assert.equal(await chatEndpointNodes({ screenSize: { width: 1178, height: 2556 },
    nodes: async () => ++reads === 1 ? [panel, controls[0]] : complete }), complete);
  assert.equal(reads, 2);
});
test('原生源查询错误必须抛出，不能冒充暂时未完成的聊天面板', async () => {
  const failure = new Error('Driver transport failed');
  await assert.rejects(chatEndpointNodes({ screenSize: { width: 1178, height: 2556 },
    nodes: async () => { throw failure; } }), e => e === failure);
});
