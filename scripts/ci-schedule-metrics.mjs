import { shardId } from './ci-schedule.mjs';

function seconds(from, to) {
  const value = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function elapsed(run, jobs, field, choose) {
  const values = jobs.map(job => seconds(run.created_at, job[field])).filter(value => value !== null);
  return values.length && values.length === jobs.length ? `${choose(...values).toFixed(1)} s` : '无有效时间数据';
}

export function renderMetrics(plan, run, jobs, passed) {
  const stages = new Map(plan.matrix.include.map(entry => [entry.label,
    plan.priority.includes(shardId(entry)) ? 'priority' : 'remaining']));
  const executed = jobs.filter(job => stages.has(job.name) && job.runner_id > 0 && job.started_at);
  const priority = executed.filter(job => stages.get(job.name) === 'priority').length;
  const queue = executed.map(job => seconds(job.created_at, job.started_at)).filter(value => value !== null);
  const failed = executed.filter(job => ['failure', 'timed_out'].includes(job.conclusion));
  const complete = passed && executed.length === plan.matrix.include.length;
  return '\n### 本轮调度观测\n\n'
    + `- 实际启动原生任务：${executed.length}/${plan.matrix.include.length}（优先 ${priority}，剩余 ${executed.length - priority}）。\n`
    + `- 原生任务创建至启动等待（含依赖、账号锁及 runner 排队）：${queue.length ? `平均 ${(queue.reduce((sum, value) => sum + value, 0) / queue.length).toFixed(1)} s，最大 ${Math.max(...queue).toFixed(1)} s` : '无有效时间数据'}。\n`
    + `- 创建运行至首个原生任务启动（含准备依赖）：${elapsed(run, executed, 'started_at', Math.min)}。\n`
    + `- 创建运行至首次原生失败反馈：${failed.length ? elapsed(run, failed, 'completed_at', Math.min) : '本轮无原生失败'}。\n`
    + `- 创建运行至全量原生成功：${complete ? elapsed(run, executed, 'completed_at', Math.max) : '未全量成功，不计作成功总耗时'}。\n`
    + '- 以上为本轮观测；需与同范围全量运行比较，才能判断改善。失败反馈和全量成功耗时分别统计。\n';
}
