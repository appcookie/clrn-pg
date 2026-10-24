// 将原生分片的 Playwright 失败浓缩到 Actions 运行摘要，完整证据仍保留在产物中。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clean = value => String(value || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
const markdown = value => clean(value).replace(/[\\`*_{}\[\]()#+.!|<>]/g, '\\$&');

export function failuresFromReport(report) {
  const failures = [];
  function visit(suites, path = []) {
    for (const suite of suites || []) {
      const location = [...path, suite.title].filter(Boolean);
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          if (test.status !== 'unexpected' && !test.results?.some(result => ['failed', 'timedOut', 'interrupted'].includes(result.status))) continue;
          const result = test.results?.find(entry => entry.error || entry.errors?.length);
          const message = clean(String(result?.error?.message || result?.errors?.[0]?.message || test.status).split(/\r?\n/)[0]);
          failures.push({ title: [...location, spec.title].join(' › '), message });
        }
      }
      visit(suite.suites, location);
    }
  }
  visit(report.suites);
  for (const error of report.errors || []) failures.push({ title: 'Playwright 启动或配置', message: clean(String(error.message).split(/\r?\n/)[0]) });
  return failures;
}

export function renderJobFailure({ label, report, runUrl, artifactUrl, testStep }) {
  const failures = report ? failuresFromReport(report) : [];
  const lines = [`### 失败分片：${markdown(label)}`, ''];
  if (failures.length) {
    for (const failure of failures.slice(0, 5)) lines.push(`- **${markdown(failure.title)}**：${markdown(failure.message).slice(0, 350)}`);
    if (failures.length > 5) lines.push(`- 另有 ${failures.length - 5} 项失败，详见测试报告。`);
  } else {
    lines.push(testStep === 'success' ? '- 原生测试已通过，后续步骤失败；请查看本分片的失败步骤。'
      : '- 没有可用的 Playwright 失败记录；请查看本分片的失败步骤和日志。');
  }
  lines.push('', `[打开本次运行](${runUrl})${artifactUrl ? ` · [下载完整测试证据](${artifactUrl})` : ''}`, '');
  return lines.join('\n');
}

export function renderGateFailure({ plan, preflight, proxy, native, summaries, runUrl }) {
  const lines = ['## iOS 完整回归失败原因', ''];
  for (const [name, status] of [['计划', plan], ['视觉基准预检', preflight], ['代理检查', proxy], ['原生分片', native]]) {
    if (status !== 'success') lines.push(`- ${name}：**${markdown(status || '未执行')}**`);
  }
  if (summaries.length) {
    lines.push('', ...summaries);
  } else if (native !== 'success') {
    lines.push('', '原生分片未上传失败摘要；请从运行页打开标红的分片查看失败步骤。');
  }
  lines.push('', `[打开本次运行](${runUrl})`, '');
  return lines.join('\n');
}

function readSummaries(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return readSummaries(file);
    return entry.isFile() && entry.name === 'summary.md' ? [readFileSync(file, 'utf8').trim()] : [];
  }).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runUrl = `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  if (process.argv[2] === 'job') {
    const reportFile = resolve('ios/artifacts/full-results/report.json');
    let report = null;
    if (existsSync(reportFile)) {
      try { report = JSON.parse(readFileSync(reportFile, 'utf8')); }
      catch { console.warn('Playwright 报告未完整写入；摘要将指向失败步骤。'); }
    }
    const summary = renderJobFailure({ label: process.env.CI_LABEL, report, runUrl,
      artifactUrl: process.env.CI_ARTIFACT_URL, testStep: process.env.CI_TEST_STEP });
    const output = resolve('ios/artifacts/ci-failure/summary.md');
    mkdirSync(resolve('ios/artifacts/ci-failure'), { recursive: true });
    writeFileSync(output, summary);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    const first = report && failuresFromReport(report)[0];
    console.log(`::error title=iOS 分片失败::${clean(process.env.CI_LABEL)}: ${first?.message || '查看失败步骤和运行摘要'}`);
  } else if (process.argv[2] === 'gate') {
    const summaries = readSummaries(resolve('ci-failures'));
    const summary = renderGateFailure({ plan: process.env.CI_PLAN, preflight: process.env.CI_PREFLIGHT,
      proxy: process.env.CI_PROXY, native: process.env.CI_NATIVE,
      summaries, runUrl });
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    const first = summaries[0]?.split('\n').find(line => line.startsWith('- **'));
    console.log(`::error title=iOS 完整回归失败::${clean(first || '打开运行摘要查看失败分片和证据入口')}`);
    console.log(summary);
  } else throw new Error('用法：node ios/full/ci-failure-summary.mjs job|gate');
}
