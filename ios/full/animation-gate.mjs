// 独立的运行清单；收集测试标题不能代替执行、基准和本轮截图验收。
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
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

export function validateAnimationReport(report, id, mode = 'compare', part = '') {
  if (!['compare', 'reference', 'smoke', 'record-only'].includes(mode)) throw new Error(`未知动画验收模式：${mode}`);
  const entry = animationCase(id);
  if (part && (id !== 'animation-20' || mode !== 'record-only'
    || !['opening', 'interactions'].includes(part))) throw new Error(`未知动画录屏分段：${id}/${part}`);
  const expected = part ? { ...entry, title: `${entry.title}_${part}` } : entry;
  const specs = [...reportSpecs(report)];
  if (specs.length !== 1 || screenshotTestKey(specs[0]) !== screenshotTestKey(expected)
    || report.stats?.expected !== 1 || report.stats.unexpected !== 0
    || report.stats.flaky !== 0 || report.stats.skipped !== 0) {
    throw new Error(`${id} 必须实际执行唯一指定动画用例且通过，不允许漏跑、跳过或重试`);
  }
  const test = specs[0].tests?.[0], result = test?.results?.[0];
  if (specs[0].tests.length !== 1 || test.expectedStatus !== 'passed' || test.status !== 'expected'
    || test.results.length !== 1 || result.status !== 'passed') throw new Error(`${id} 动画未实际通过`);
  if (mode === 'record-only') {
    if (!(result.attachments || []).some(a => a.contentType === 'video/mp4' && a.path)) {
      throw new Error(`${id} 缺少真实原生录屏`);
    }
    return { ...entry, images: [] };
  }
  if (mode === 'compare' && entry.images.length === 0) throw new Error(`${id} 尚无完整审查后的截图清单`);
  const images = entry.images.length ? entry.images : [...new Set((result.attachments || [])
    .filter(a => a.contentType === 'image/png' && a.name.endsWith('.png')).map(a => a.name))];
  if (!images.length) throw new Error(`${id} 首次采集缺少可审查的候选 PNG 截图`);
  for (const name of images) {
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
  // Discovery only describes this run; it must never approve the inventory.
  return { ...entry, images };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, id] = process.argv.slice(2);
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const mode = process.env.IOS_ANIMATION_RECORD_ONLY === '1' ? 'record-only' : process.env.IOS_VISUAL_MODE || 'compare';
  const entry = validateAnimationReport(report, id, mode, process.env.ANIMATION_PART || '');
  const root = resolve(dirname(file));
  for (const attachment of [...reportSpecs(report)][0].tests[0].results[0].attachments) {
    if (attachment.contentType !== 'video/mp4') continue;
    const path = resolve(attachment.path);
    if (!path.startsWith(root + sep)) throw new Error(`${id} 录屏不在本轮结果目录内`);
    const descriptor = openSync(path, 'r');
    try {
      const header = Buffer.alloc(12);
      if (readSync(descriptor, header, 0, 12, 0) !== 12 || header.toString('ascii', 4, 8) !== 'ftyp') {
        throw new Error(`${id} 原生录屏文件无效`);
      }
    } finally { closeSync(descriptor); }
  }
  console.log(`动画本轮验收（${mode}）：${entry.title}；${entry.images.length} 张动画截图有效。`
    + (mode === 'compare' ? '已完成动画基准比较。' : '本模式不代表已完成动画基准比较或批准新基准。'));
}
