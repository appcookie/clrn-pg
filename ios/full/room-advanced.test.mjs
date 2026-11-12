import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRoomAdvancedOptions } from './room-advanced.ts';

const screen = { width: 1178, height: 2556 };
function layout() {
  const node = (res, bounds = { x: 0, y: 200, width: 1178, height: 80 }) => ({
    res, bounds, visible: true, clazz: 'XCUIElementTypeOther', children: [],
  });
  const fields = ['base-create-room-screen', 'allow-audience-text-message-switch',
    'allow-audience-voice-message-switch', 'allow-player-text-message-switch',
    'allow-player-voice-message-switch'].map(res => node(res));
  const footer = node('create-room-tips-text', { x: 30, y: 2100, width: 1100, height: 120 });
  const list = { ...node('options'), clazz: 'XCUIElementTypeScrollView',
    bounds: { x: 0, y: 160, width: 1178, height: 2100 }, children: [...fields, footer] };
  return [list, ...fields, footer];
}

test('高级设置允许文本和语音消息，但拒绝恢复实时音视频开关', () => {
  const nodes = layout();
  assert.doesNotThrow(() => assertRoomAdvancedOptions(nodes, screen));
  assert.throws(() => assertRoomAdvancedOptions([...nodes, { res: 'allow-player-rtc-switch' }], screen), /音视频/);
  for (const res of ['allow-player-text-message-switch', 'allow-player-voice-message-switch',
    'allow-audience-text-message-switch', 'allow-audience-voice-message-switch']) {
    assert.throws(() => assertRoomAdvancedOptions(nodes.filter(node => node.res !== res), screen), /保留消息设置/);
  }
});

test('高级设置拒绝缺失、隐藏、屏幕外或被滚动容器裁切的页脚', () => {
  for (const change of ['missing', 'hidden', 'offscreen', 'clipped']) {
    let nodes = layout();
    const footer = nodes.find(node => node.res === 'create-room-tips-text');
    if (change === 'missing') nodes = nodes.filter(node => node !== footer);
    if (change === 'hidden') footer.visible = false;
    if (change === 'offscreen') footer.bounds.y = 2600;
    if (change === 'clipped') footer.bounds.y = 2200;
    assert.throws(() => assertRoomAdvancedOptions(nodes, screen), /页脚/);
  }
});
