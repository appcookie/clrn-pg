// A missing reviewed inventory blocks compare, but the incomplete native case
// can still collect a reference candidate in the same PR run.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import inventory from './animation-gate-cases.json' with { type: 'json' };

export function selectCiMatrix(matrix, preflightOutcome, referenceCases = '', availableCases = inventory.cases) {
  if (!Array.isArray(matrix?.include) || !matrix.include.length) throw new Error('iOS CI 矩阵为空');
  if (preflightOutcome === 'success') return { matrix, runNative: true, diagnostic: false };
  if (preflightOutcome !== 'failure') throw new Error(`未知基准预检结果：${preflightOutcome}`);
  const cases = new Map(availableCases.map(item => [item.id, item]));
  const requested = new Set(referenceCases.split(',').filter(Boolean));
  const incomplete = matrix.include.filter(item => item.animation && requested.has(item.animation)
    && cases.get(item.animation)?.images.length === 0);
  if (incomplete.length !== requested.size) throw new Error('诊断分片与预检缺项不一致');
  if (!incomplete.length) return { matrix: { include: [] }, runNative: false, diagnostic: false };
  return { matrix: { include: incomplete.map(item => ({ ...item, mode: 'reference',
    label: `reference / ${item.label}` })) }, runNative: true, diagnostic: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const selected = selectCiMatrix(JSON.parse(process.env.IOS_CI_MATRIX || '{}'),
    process.env.IOS_BASELINE_PREFLIGHT_OUTCOME, process.env.IOS_REFERENCE_CASES || '');
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(selected.matrix)}\n`
    + `run_native=${selected.runNative}\n`);
  if (selected.diagnostic) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `基准预检失败；仅运行 ${selected.matrix.include.map(item => item.animation).join('、')} 的 reference 采集。`
    + '该运行只提供待审查候选，iOS animation gate 仍会失败。\n');
}
