import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { waitReviewCloseButton, waitReviewContent } from './review-readiness.ts';

const node = (res, text, bounds = { x: 100, y: 100, width: 20, height: 20 }) =>
  ({ res, text, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const close = node('review-board-close-button', undefined, { x: 293, y: 180, width: 70, height: 54 });
const page = node('review-board-page-input', '1', { x: 602, y: 2382, width: 124, height: 81 });
const total = node(undefined, '/1', { x: 785, y: 2394, width: 40, height: 57 });
const settlement = [node('PlayerBenefitView_Settlement', '180'), node('PlayerBenefitView_Settlement', '-180'), page, total];
const action = node('TexasPlayerActionIcon_container');

test('牌谱关闭按钮用唯一原生目标的已完成观测，慢查询超过外层预算也不丢弃实际结果', async () => {
  let calls = 0;
  const actual = await waitReviewCloseButton({ transientMarker: async res => {
    assert.equal(res, 'review-board-close-button');
    calls++;
    await delay(10);
    return close;
  } }, true, { timeout: 1, interval: 0 });
  assert.equal(actual, close);
  assert.equal(calls, 2);
  const sequence = [null, close, { ...close, bounds: { ...close.bounds, x: 300 } },
    { ...close, bounds: { ...close.bounds, x: 300 } }];
  calls = 0;
  await waitReviewCloseButton({ transientMarker: async () => sequence[calls++] }, true, { interval: 0 });
  assert.equal(calls, 4);
});

test('牌谱真实缺失、仍未关闭和驱动错误必须失败，不能重复打开或把异常当缺失', async () => {
  await assert.rejects(waitReviewCloseButton({ transientMarker: async () => null }, true,
    { timeout: 0, interval: 0 }));
  await assert.rejects(waitReviewCloseButton({ transientMarker: async () => close }, false,
    { timeout: 0, interval: 0 }));
  const error = new Error('WDA disconnected');
  await assert.rejects(waitReviewCloseButton({ transientMarker: async () => { throw error; } }), e => e === error);
  let calls = 0;
  await waitReviewCloseButton({ transientMarker: async () => { calls++; return null; } }, false, { interval: 0 });
  assert.equal(calls, 2);
});

test('完整牌谱语义用两次完成的树验证，保留两人结算、页签、页码、总页数和无键盘门禁', async () => {
  let calls = 0;
  const nodes = [...settlement, action];
  const actual = await waitReviewContent({ nodes: async () => {
    calls++; await delay(10); return nodes;
  } }, 'record', { timeout: 1, interval: 0 });
  assert.equal(actual, nodes);
  assert.equal(calls, 2);
  await waitReviewContent({ nodes: async () => settlement }, 'settlement', { interval: 0 });
  const keyboard = { ...node(undefined), clazz: 'XCUIElementTypeKeyboard' };
  for (const wrong of [settlement, [...settlement, action, keyboard],
    [...settlement.slice(0, 2), { ...page, text: '2' }, total, action],
    [settlement[0], page, total, action],
    [...settlement.slice(0, 3), { ...total, text: '/2' }, action],
    [...settlement.slice(0, 3), { ...total, bounds: { ...total.bounds, y: 2408, height: 80 } }, action]]) {
    await assert.rejects(waitReviewContent({ nodes: async () => wrong }, 'record', { timeout: 0, interval: 0 }));
  }
  await waitReviewContent({ nodes: async () => [...nodes, { ...keyboard, visible: false }] }, 'record', { interval: 0 });
});

test('同一物理页码框的原生wrapper/TextField可重复暴露，实际值和其他位置的重复仍严格检查', async () => {
  const wrapper = { ...page, text: undefined };
  const field = { ...page, clazz: 'XCUIElementTypeTextField' };
  const nodes = [...settlement.slice(0, 2), wrapper, field, total, action];
  await waitReviewContent({ nodes: async () => nodes }, 'record', { interval: 0 });
  await waitReviewContent({ nodes: async () => nodes.map(n => n === field ? { ...field, res: undefined } : n) },
    'record', { interval: 0 });
  for (const bad of [
    [...nodes, { ...page, bounds: { ...page.bounds, x: 500 } }],
    nodes.map(n => n === field ? { ...field, text: '2' } : n),
    nodes.filter(n => n !== field),
  ]) await assert.rejects(waitReviewContent({ nodes: async () => bad }, 'record', { timeout: 0, interval: 0 }));
});
