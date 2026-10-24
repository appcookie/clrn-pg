import assert from 'node:assert/strict';
import test from 'node:test';
import { failuresFromReport, renderGateFailure, renderJobFailure } from './ci-failure-summary.mjs';

const report = { suites: [{ title: 'tests/games.spec.ts', specs: [{ title: 'en / zhajinhua / pre_game_first',
  tests: [{ status: 'unexpected', results: [{ status: 'failed', error: {
    message: 'Error: drawer-menu-item-exit 应可见\n\nTimeout 45000ms exceeded',
  } }] }] }] }] };

test('失败分片摘要显示实际断言和证据入口', () => {
  assert.deepEqual(failuresFromReport(report), [{
    title: 'tests/games.spec.ts › en / zhajinhua / pre_game_first',
    message: 'Error: drawer-menu-item-exit 应可见',
  }]);
  const summary = renderJobFailure({ label: 'recording / animation-15', report,
    runUrl: 'https://github.com/example/actions/runs/42', artifactUrl: 'https://github.com/example/artifacts/7' });
  assert.match(summary, /animation-15/);
  assert.match(summary, /drawer-menu-item-exit 应可见/);
  assert.match(summary, /下载完整测试证据/);
  assert.doesNotMatch(summary, /Timeout 45000ms/);
});

test('测试报告缺失时摘要明确指向失败步骤', () => {
  const summary = renderJobFailure({ label: 'guest / en / pages', report: null, testStep: 'skipped', runUrl: 'https://example.test' });
  assert.match(summary, /没有可用的 Playwright 失败记录/);
  const gate = renderGateFailure({ plan: 'success', preflight: 'success', proxy: 'success', native: 'failure',
    summaries: [summary], runUrl: 'https://example.test' });
  assert.match(gate, /原生分片：\*\*failure\*\*/);
  assert.match(gate, /guest \/ en \/ pages/);
});
