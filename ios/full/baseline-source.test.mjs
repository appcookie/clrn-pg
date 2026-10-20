import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBaselineSource } from './baseline-source.mjs';

test('保留原基准来源，同时允许新图片记录独立且完整的 CI 来源', () => {
  const review = JSON.parse(readFileSync('ios/snapshots/v1/review.json', 'utf8'));
  validateBaselineSource(review);
  const added = { sourceRun: 39457123246,
    sourceUrl: 'https://github.com/appcookie/clrn-pg/actions/runs/39457123246',
    sourceWorkflowHead: 'bc5ad74c133bf45f489b7eeb60038d0def2a8122',
    sourceArtifacts: ['ios-rooms-en-animation-5-1'] };
  validateBaselineSource(added);
  for (const key of Object.keys(added)) {
    const incomplete = { ...added }; delete incomplete[key];
    assert.throws(() => validateBaselineSource(incomplete));
  }
  assert.throws(() => validateBaselineSource({ ...added, sourceRun: review.sourceRun }));
  assert.throws(() => validateBaselineSource({ ...added, sourceArtifacts: ['../unrelated'] }));
});
