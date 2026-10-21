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

test('后续构建的新图记录完整独立身份，不得把旧PNG重新标记为新构建', () => {
  const review = JSON.parse(readFileSync('ios/snapshots/v1/review.json', 'utf8'));
  const source = { sourceRun: 39543731649,
    sourceUrl: 'https://github.com/appcookie/clrn-pg/actions/runs/39543731649',
    sourceWorkflowHead: '13f99ba31dee04d5225f1cc32f7243c9edf50243',
    sourceArtifacts: ['ios-texas-en-animation-13-1'],
    applicationCommit: 'b99077e07427f469838aeb34811975cda4fe2487',
    releaseTag: 'ios-staging-14-1-b99077e07427', packageSha256: 'a'.repeat(64) };
  const unchanged = JSON.stringify(review);
  validateBaselineSource(source);
  validateBaselineSource(review);
  assert.equal(JSON.stringify(review), unchanged);
  for (const key of ['applicationCommit', 'releaseTag', 'packageSha256']) {
    const incomplete = { ...source }; delete incomplete[key];
    assert.throws(() => validateBaselineSource(incomplete), /构建来源/);
  }
  assert.throws(() => validateBaselineSource({ ...source, releaseTag: review.releaseTag }), /构建来源/);
  assert.throws(() => validateBaselineSource({ ...source, packageSha256: 'a'.repeat(63) }), /构建来源/);
});
