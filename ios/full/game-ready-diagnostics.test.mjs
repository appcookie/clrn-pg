import test from 'node:test';
import assert from 'node:assert/strict';
import { observeStatisticsReady } from './game-ready-diagnostics.ts';

const target = 'PlayerStatisticComponent_Item_Value_0';
test('original samples distinguish text mismatch from reconnection without exporting text', async () => {
  const original = new Error('original');
  let evidence;
  await assert.rejects(observeStatisticsReady(target, '100', async observe => {
    observe([{ res: target, text: 'private-value' }], Date.now());
    observe([{ res: target, text: '100' }, { text: 'Connecting...' }], Date.now());
    throw original;
  }, body => { evidence = JSON.parse(body); }), error => error === original);
  assert.deepEqual(evidence.samples.map(({ targetPresent, expectedTextPresent, connecting }) =>
    [targetPresent, expectedTextPresent, connecting]), [[true, false, false], [true, true, true]]);
  assert.equal(JSON.stringify(evidence).includes('private'), false);
});
test('diagnostic failure preserves assertion error and successful assertions remain unchanged', async () => {
  const original = new Error('original');
  const broken = () => { throw new Error('diagnostic'); };
  await assert.rejects(observeStatisticsReady(target, '100', async observe => {
    for (let i = 0; i < 20; i++) observe([], Date.now());
    throw original;
  }, broken), error => error === original);
  assert.equal(await observeStatisticsReady(target, '100', async observe => {
    observe([], Date.now()); return 'result';
  }, broken), 'result');
});
