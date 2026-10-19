import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingCardBounds } from './staging-card.ts';

function node(res, bounds, children = [], clazz = 'XCUIElementTypeOther') {
  return { res, clazz, bounds, children, visible: true };
}
const screen = { width: 1178, height: 2556 };
const overlayBounds = { x: 0, y: 0, ...screen };

test('真实中文几何选择不透明外卡片，排除全屏overlay、全宽wrapper及较小内卡片', () => {
  const title = node('staging-dialog-title', { x: 149, y: 690, width: 880, height: 96 });
  const content = node('staging-dialog-content', { x: 77, y: 831, width: 1024, height: 924 });
  const confirm = node('confirm-button', { x: 149, y: 1752, width: 880, height: 117 });
  const scroll = node('[redacted]', { x: 77, y: 834, width: 1024, height: 969 }, [content, confirm], 'XCUIElementTypeScrollView');
  const inner = node('[redacted]', { x: 77, y: 618, width: 1024, height: 1257 }, [title, scroll]);
  const card = node('[redacted]', { x: 77, y: 618, width: 1024, height: 1395 }, [inner]);
  const wrapper = node('staging-dialog-wrapper', { x: 0, y: 177, width: 1178, height: 2277 }, [card]);
  const overlay = node('staging-dialog', overlayBounds, [wrapper]);
  assert.deepEqual(stagingCardBounds([overlay, wrapper, card, inner, title, scroll, content, confirm], screen), card.bounds);
  // A hidden background brand has bounds y345/h186: the visible part above this card is positive.
  assert.equal(Math.min(345 + 186, stagingCardBounds([overlay], screen).y - 4) - 345, 186);
});

test('只有全屏modal或缺少真实子树锚点时不能推算卡片位置', () => {
  const anchors = ['staging-dialog-title', 'staging-dialog-content', 'confirm-button'].map(res => node(res, overlayBounds));
  assert.throws(() => stagingCardBounds([node('staging-dialog', overlayBounds, anchors)], screen), /不能用全屏遮罩代替/);
  const incomplete = node('card', { x: 77, y: 618, width: 1024, height: 1395 }, anchors.slice(0, 2));
  assert.throws(() => stagingCardBounds([incomplete], screen), /未找到/);
});
