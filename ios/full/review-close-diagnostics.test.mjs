import test from 'node:test';
import assert from 'node:assert/strict';
import { observeReviewClose } from './review-close-diagnostics.ts';
import { observeGameGone } from './game-gone-diagnostics.ts';

const panel = { x: 248, y: 0, width: 930, height: 2556 };
const screen = { width: 1178, height: 2556 };

test('牌谱关闭诊断只复用最后两次观测和原点击，不导出正文或任意标记', async () => {
  let evidence, actions = 0;
  await observeReviewClose(panel, screen, async (tap, observe) => {
    actions++;
    for (let index = 0; index < 3; index++) observe([
      { res: 'screen-mask-touch-to-close', bounds: panel, enabled: true, visible: true, text: 'private-body' },
      { res: 'private-user', bounds: panel, text: 'private-body' },
    ]);
    tap({ x: 124, y: 1313 });
  }, body => { evidence = JSON.parse(body); });
  assert.equal(actions, 1);
  assert.equal(evidence.observations.length, 2);
  assert.deepEqual(evidence.tap.point, { x: 124, y: 1313 });
  assert.equal(evidence.returned, true);
  assert.ok(!JSON.stringify(evidence).includes('private'));
});

test('牌谱诊断失败保留成功或同一个原始输入异常', async () => {
  for (const original of [undefined, new Error('original')]) {
    let actions = 0;
    const action = observeReviewClose(panel, screen, async () => {
      actions++;
      if (original) throw original;
    }, () => { throw new Error('diagnostic'); });
    if (original) await assert.rejects(action, error => error === original);
    else await action;
    assert.equal(actions, 1);
  }
});

test('牌谱定向查询成功也保留原样本，便于核对整树仍有面板的反例', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let assertions = 0;
  await observeGameGone('review-board-description-text', async observe => {
    assertions++;
    observe([], Date.now());
  }, 'predicate');
  assert.equal(assertions, 1);
  const evidence = JSON.parse(logs[0][1]);
  assert.equal(evidence.source, 'predicate');
  assert.equal(evidence.samples[0].targetPresent, false);
  assert.equal(evidence.samples.length, 1);
});
