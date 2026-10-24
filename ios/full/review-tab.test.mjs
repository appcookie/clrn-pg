import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeReviewTab } from './review-tab.ts';
const slider = { res: 'review-board-slider', bounds: { x: 413, y: 2259, width: 601, height: 120 } };
const header = { text: 'Settlement', bounds: { x: 293, y: 918, width: 184, height: 48 } };
const settlement = { text: 'Settlement', bounds: { x: 248, y: 2154, width: 469, height: 105 } };
const record = { text: 'Record', bounds: { x: 713, y: 2154, width: 465, height: 105 } };
test('选择滑块上方真实标签，不能点击同名结算内容标题', () => {
  const nodes = [slider, header, settlement, record];
  assert.equal(nativeReviewTab(nodes, 'settlement'), settlement);
  assert.equal(nativeReviewTab(nodes, 'record'), record);
  assert.throws(() => nativeReviewTab([slider, header, record], 'settlement'), /唯一/);
  assert.throws(() => nativeReviewTab([slider, settlement, { ...record, visible: false }], 'record'), /唯一/);
  assert.throws(() => nativeReviewTab([slider, settlement, record, { ...record }], 'record'), /唯一/);
});
