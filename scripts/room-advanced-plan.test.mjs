import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { iosScenarios } from '../ios/full/scenarios.ts';

test('高级设置定向计划只执行三语言德州和短牌六例，拒绝缩减自动门禁', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ios-room-advanced-'));
  try {
    const output = join(directory, 'matrix');
    const environment = { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '',
      GITHUB_RUN_ID: '123', GITHUB_EVENT_NAME: 'workflow_dispatch', CI_IOS_GROUP: 'rooms',
      CI_IOS_LOCALE: 'all', CI_ROOM_CASE: 'rtc-retirement', CI_FUNCTIONAL_CASE: 'all', CI_ANIMATION_CASE: '',
      CLRN_IOS_CI_TEST_ACCOUNTS: JSON.stringify({ accounts: [
        { username: 'clrnciios001', password: 'fake-password', status: 'ready' },
      ] }) };
    const run = overrides => spawnSync(process.execPath, ['scripts/plan-ci-accounts.mjs', 'ios'], {
      env: { ...environment, ...overrides }, encoding: 'utf8',
    });
    const result = run({});
    assert.equal(result.status, 0, result.stderr);
    const matrix = JSON.parse(readFileSync(output, 'utf8').trim().slice('matrix='.length));
    assert.deepEqual(matrix.include.map(entry => entry.locale).sort(), ['en', 'zh-Hans', 'zh-Hant']);
    for (const entry of matrix.include) {
      const selected = iosScenarios(entry.locale, entry.group)
        .filter(scenario => new RegExp(entry.filter).test(scenario.pageLabel));
      assert.deepEqual(selected.map(scenario => scenario.pageLabel).sort(), [
        'signed_in_create_room_advanced_six_plus', 'signed_in_create_room_advanced_texas',
      ]);
    }
    for (const overrides of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'push' },
      { CI_IOS_GROUP: 'pr' }, { CI_IOS_GROUP: 'guest' }, { CI_ROOM_CASE: 'unknown' }]) {
      assert.notEqual(run(overrides).status, 0);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
