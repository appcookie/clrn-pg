// 独立的运行清单；收集测试标题不能代替执行、基准和本轮截图验收。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import inventory from './animation-gate-cases.json' with { type: 'json' };
import { reportSpecs, screenshotTestKey } from './guest-screenshot-contract.mjs';
export const animationCases = inventory.cases;

export function animationCase(id) {
  const entry = animationCases.find(item => item.id === id);
  if (!entry) throw new Error(`未知动画门禁用例：${id}`);
  return entry;
}

export function validateAnimationReport(report, id, mode = 'compare') {
  const entry = animationCase(id);
  const specs = [...reportSpecs(report)];
  if (specs.length !== 1 || screenshotTestKey(specs[0]) !== screenshotTestKey(entry)
    || report.stats?.expected !== 1 || report.stats.unexpected !== 0
    || report.stats.flaky !== 0 || report.stats.skipped !== 0) {
    throw new Error(`${id} 必须实际执行唯一指定动画用例且通过，不允许漏跑、跳过或重试`);
  }
  const test = specs[0].tests?.[0], result = test?.results?.[0];
  if (specs[0].tests.length !== 1 || test.expectedStatus !== 'passed' || test.status !== 'expected'
    || test.results.length !== 1 || result.status !== 'passed') throw new Error(`${id} 动画未实际通过`);
  if (mode === 'compare' && entry.images.length === 0) throw new Error(`${id} 尚无完整审查后的截图清单`);
  for (const name of entry.images) {
    const attachments = (result.attachments || []).filter(a => a.contentType === 'image/png'
      && a.name.replace(/\.png$/, '') === name.replace(/\.png$/, ''));
    if (!attachments.length) throw new Error(`${id} 缺少本轮动画截图：${name}`);
    for (const a of attachments) {
      if (!a.body || a.path) throw new Error(`${id} 缺少原始 PNG：${name}`);
      PNG.sync.read(Buffer.from(a.body, 'base64'), { checkCRC: true });
    }
  }
  if (!(result.attachments || []).some(a => a.contentType === 'video/mp4' && a.path)) {
    throw new Error(`${id} 缺少真实原生录屏`);
  }
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, id] = process.argv.slice(2);
  const entry = validateAnimationReport(JSON.parse(readFileSync(file, 'utf8')), id, process.env.IOS_VISUAL_MODE);
  console.log(`动画实际执行并通过：${entry.title}；${entry.images.length} 张必需截图齐全。`);
}
