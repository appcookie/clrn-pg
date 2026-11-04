import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const shardId = entry => JSON.stringify([entry.group, entry.locale, entry.shard]);

function normalized(entry) {
  // 账号按 run ID 轮转；它不是测试分片身份，执行时仍使用本轮账号及独占锁。
  return Object.fromEntries(Object.keys(entry).sort().filter(key => key !== 'account').map(key => [key, entry[key]]));
}

export function validateMatrix(matrix) {
  if (!Array.isArray(matrix?.include)) throw new Error('测试计划必须包含 include');
  const ids = matrix.include.map(shardId);
  const labels = matrix.include.map(entry => entry.label);
  if (new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) throw new Error('分片身份或检查名称重复');
  if (matrix.include.some(entry => ![entry.group, entry.locale, entry.shard, entry.label].every(value => typeof value === 'string' && value.length))) {
    throw new Error('分片身份不完整');
  }
  return matrix.include;
}

export function fingerprint(matrix, configuration) {
  return digest({ configuration, entries: validateMatrix(matrix).map(normalized).sort((a, b) => shardId(a).localeCompare(shardId(b))) });
}

export function validatePartition(plan) {
  const entries = validateMatrix(plan.matrix);
  const all = entries.map(shardId).sort();
  const scheduled = [...plan.priority, ...plan.remaining].sort();
  if (JSON.stringify(all) !== JSON.stringify(scheduled)) throw new Error('阶段分区未恰好覆盖完整计划');
  return entries;
}

function jobsByName(jobs) {
  const names = new Map();
  for (const job of jobs) {
    if (names.has(job.name)) throw new Error('历史检查名称重复，无法可靠映射');
    names.set(job.name, job);
  }
  return names;
}

function stageFailures(ids, entries, jobs) {
  const labels = new Map(entries.map(entry => [shardId(entry), entry.label]));
  return ids.filter(id => {
    const job = jobs.get(labels.get(id));
    if (!job || job.status !== 'completed') throw new Error('历史分片结果缺失或未完成');
    return job.conclusion !== 'success';
  });
}

export function priorFailures(current, previous, jobs) {
  if (previous.schema !== 1 || previous.fingerprint !== current.fingerprint
    || digest(previous.scope) !== digest(current.scope)) throw new Error('历史配置或 PR/分支不兼容');
  const entries = validatePartition(previous);
  if (fingerprint(previous.matrix, previous.configuration) !== previous.fingerprint) throw new Error('历史计划指纹无效');
  const names = jobsByName(jobs);
  const failedPriority = stageFailures(previous.priority, entries, names);
  // 未放行的 remaining 不变成下一轮的失败项，完整计划仍保存在每一轮的 artifact。
  if (failedPriority.length) return failedPriority;
  return stageFailures(previous.remaining, entries, names);
}

export function partition(plan, priority = []) {
  const entries = validateMatrix(plan.matrix);
  const wanted = new Set(priority);
  if (priority.some(id => !entries.some(entry => shardId(entry) === id))) throw new Error('历史分片不在当前计划');
  const result = { ...plan, priority: entries.filter(entry => wanted.has(shardId(entry))).map(shardId),
    remaining: entries.filter(entry => !wanted.has(shardId(entry))).map(shardId) };
  validatePartition(result);
  return result;
}

export function stageMatrix(plan, stage) {
  const ids = new Set(plan[stage]);
  return { include: plan.matrix.include.filter(entry => ids.has(shardId(entry))) };
}

export function stageSucceeded(count, result) {
  return count > 0 ? result === 'success' : result === 'skipped';
}

export function gatePassed(plan, results) {
  validatePartition(plan);
  if (plan.schema !== 1 || fingerprint(plan.matrix, plan.configuration) !== plan.fingerprint) throw new Error('本轮完整计划损坏');
  if (!plan.matrix.include.length) return false;
  return ['plan', 'preflight', 'proxy', 'build'].every(key => results[key] === 'success')
    && stageSucceeded(plan.priority.length, results.priority)
    && stageSucceeded(plan.remaining.length, results.remaining);
}

export function scheduleSummary(plan) {
  const labels = ids => plan.matrix.include.filter(entry => ids.includes(shardId(entry)))
    .map(entry => `- ${entry.label}`).join('\n') || '- 无';
  return `## iOS 两阶段调度\n\n历史来源：${plan.history || '无'}\n\n调度原因：${plan.reason}\n\n`
    + `完整计划 ${plan.matrix.include.length} 项；历史只决定顺序，所有项均验证当前提交。\n\n`
    + `### 优先检查（${plan.priority.length}）\n\n${labels(plan.priority)}\n\n`
    + `### 剩余检查（${plan.remaining.length}）\n\n${labels(plan.remaining)}\n`;
}
