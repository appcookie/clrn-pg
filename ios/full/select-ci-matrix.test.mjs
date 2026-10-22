import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCiMatrix } from './select-ci-matrix.mjs';

const matrix = { include: [
  { group: 'guest', shard: 'startup', label: 'guest / en / startup' },
  { group: 'texas', animation: 'animation-14', label: 'animation / animation-14' },
  { group: 'texas', animation: 'animation-20', label: 'animation / animation-20' },
] };

test('complete baselines keep the full compare matrix', () => {
  assert.deepEqual(selectCiMatrix(matrix, 'success'),
    { matrix, runNative: true, diagnostic: false });
});

test('failed preflight only collects missing inventory as reference and never selects the full matrix', () => {
  const selected = selectCiMatrix(matrix, 'failure', 'animation-14');
  assert.equal(selected.runNative, true);
  assert.equal(selected.diagnostic, true);
  assert.deepEqual(selected.matrix.include.map(item => item.animation), ['animation-14']);
  assert.equal(selected.matrix.include[0].mode, 'reference');
  assert.equal(matrix.include[1].mode, undefined);
});

test('unrelated preflight failures launch no native runner', () => {
  assert.deepEqual(selectCiMatrix({ include: [matrix.include[0], matrix.include[2]] }, 'failure'),
    { matrix: { include: [] }, runNative: false, diagnostic: false });
  assert.throws(() => selectCiMatrix(matrix, 'failure', 'animation-20'), /不一致/);
  assert.throws(() => selectCiMatrix(matrix, 'skipped'), /未知基准预检结果/);
});
