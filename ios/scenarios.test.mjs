// 确保首批页面均由明确的原生入口和就绪标识驱动，筛选时不默默执行空集合。
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, selectScenarios } from './scenarios.mjs';

test('游客页面清单没有重复且可定向运行', () => {
  assert.equal(new Set(scenarios.map(scenario => scenario.name)).size, scenarios.length);
  assert.ok(scenarios.every(scenario => scenario.tab && scenario.ready));
  assert.deepEqual(selectScenarios('^(hall|login)$').map(scenario => scenario.name), ['hall', 'login']);
  assert.throws(() => selectScenarios('does-not-exist'));
});
