import assert from 'node:assert/strict';
import test from 'node:test';
import { partition, shardId } from './ci-schedule.mjs';
import { renderMetrics } from './ci-schedule-metrics.mjs';

const entries = ['a', 'b'].map(shard => ({ group: 'guest', locale: 'en', shard, label: shard }));
const plan = partition({ matrix: { include: entries } }, [shardId(entries[0])]);
const time = seconds => new Date(seconds * 1000).toISOString();
const run = { created_at: time(0) };
const completed = { name: 'a', runner_id: 1, created_at: time(2), started_at: time(10), completed_at: time(30), conclusion: 'failure' };

test('优先失败只计实际启动项，等待和失败反馈与成功全量耗时分开', () => {
  const summary = renderMetrics(plan, run, [completed, { name: 'b', runner_id: 0, conclusion: 'skipped' }], false);
  assert.match(summary, /1\/2（优先 1，剩余 0）/);
  assert.match(summary, /平均 8\.0 s，最大 8\.0 s/);
  assert.match(summary, /首次原生失败反馈：30\.0 s/);
  assert.match(summary, /未全量成功，不计作成功总耗时/);
});

test('全量成功按最晚必需分片完成计算，不把门禁 job 和 skipped 占位计入任务数', () => {
  const jobs = [{ ...completed, conclusion: 'success' },
    { ...completed, name: 'b', created_at: time(35), started_at: time(40), completed_at: time(60), conclusion: 'success' },
    { ...completed, name: 'screenshot-video-gate', completed_at: time(90) }];
  const summary = renderMetrics(plan, run, jobs, true);
  assert.match(summary, /2\/2（优先 1，剩余 1）/);
  assert.match(summary, /平均 6\.5 s/);
  assert.match(summary, /全量原生成功：60\.0 s/);
  assert.match(summary, /本轮无原生失败/);
});

test('时间缺失时显示数据不可用，不编造等待或成功耗时', () => {
  assert.match(renderMetrics(plan, {}, [{ name: 'a', runner_id: 1, started_at: 'invalid' }], false), /无有效时间数据/);
  const partial = [{ ...completed, conclusion: 'success' }, { ...completed, name: 'b', completed_at: undefined }];
  assert.match(renderMetrics(plan, run, partial, true), /全量原生成功：无有效时间数据/);
});
