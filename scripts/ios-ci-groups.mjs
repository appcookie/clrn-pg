// Execute every planned group, even after a failure; persist progress before
// starting so cancellation or a killed process can never look like a pass.
import { isDeepStrictEqual } from 'node:util';

export async function executeIosGroups(groups, hooks) {
  if (!groups.length) throw new Error('业务执行计划为空');
  const results = groups.map(group => ({ group, status: 'pending', errors: [] }));
  await hooks.save(results);
  for (const result of results) {
    if (hooks.cancelled()) {
      result.status = 'cancelled';
      await hooks.save(results);
      continue;
    }
    result.status = 'running';
    result.startedAt = new Date().toISOString();
    await hooks.save(results);
    await attempt(result, 'prepare', () => hooks.prepare(result.group));
    if (!result.errors.length) await attempt(result, 'test', () => hooks.test(result.group));
    if (!result.errors.length) await attempt(result, 'validate', () => hooks.validate(result.group));
    // Cleanup and evidence collection are independent of the test exit code.
    await attempt(result, 'cleanup', () => hooks.cleanup(result.group));
    await attempt(result, 'archive', () => hooks.archive(result.group));
    result.status = hooks.cancelled() ? 'cancelled' : result.errors.length ? 'failed' : 'passed';
    result.finishedAt = new Date().toISOString();
    await hooks.save(results);
  }
  return results;
}

async function attempt(result, phase, action) {
  const started = Date.now();
  try { await action(); }
  catch (error) { result.errors.push({ phase, message: error.message }); }
  result[`${phase}Ms`] = Date.now() - started;
}

export function assertGroupsPassed(planned, results) {
  if (planned.length !== results.length || !planned.length) throw new Error('分组结果不完整');
  for (const [index, group] of planned.entries()) {
    if (!isDeepStrictEqual(group, results[index].group) || results[index].status !== 'passed') {
      throw new Error(`必须执行的分组未通过：${group.label}`);
    }
  }
}
