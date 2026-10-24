// compare 运行前检查人工审查记录和每张 PNG 的原始 SHA，避免未审查图进入回归基准。
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { baselineRoot, baselineRelativePath } from './baseline-path.mjs';
import { guestScreenshotTests } from './guest-screenshot-contract.mjs';
import { animationCase } from './animation-gate.mjs';
import { validateBaselineSource } from './baseline-source.mjs';

const matrix = JSON.parse(process.env.IOS_CI_MATRIX || '{}');
if (!Array.isArray(matrix.include) || matrix.include.length === 0) throw new Error('iOS CI 矩阵为空。');
const locales = new Set(matrix.include.map(item => item.locale));
const buildFile = `${baselineRoot}/build-info.json`;
if (!existsSync(buildFile)) throw new Error(`compare 缺少已审查基准的构建身份：${buildFile}`);
const build = JSON.parse(readFileSync(buildFile, 'utf8'));
if (build.platform !== 'ios' || build.packageKind !== 'simulator'
  || !/^[a-f0-9]{40}$/.test(build.applicationCommit || '')
  || !/^[a-f0-9]{64}$/.test(build.package?.sha256 || '')) {
  throw new Error(`compare 的基准构建身份无效：${buildFile}`);
}
const reviewFile = `${baselineRoot}/review.json`;
if (!existsSync(reviewFile)) throw new Error(`compare 缺少人工审查记录：${reviewFile}`);
const review = JSON.parse(readFileSync(reviewFile, 'utf8'));
validateBaselineSource(review);
if (review.status !== 'approved-current-release' || !Array.isArray(review.files) || !review.files.length
  || review.releaseTag !== build.releaseTag || review.applicationCommit !== build.applicationCommit
  || review.packageSha256 !== build.package?.sha256) {
  throw new Error('compare 的审查记录与参考图来源不匹配。');
}
const paths = new Set();
const reviewedLocales = new Set();
for (const entry of review.files) {
  if (Object.hasOwn(entry, 'source')) validateBaselineSource(entry.source);
  if (typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')
    || !entry.path.endsWith('.png') || entry.path.includes('..') || entry.path.startsWith('/')) {
    throw new Error('审查记录含无效图片路径或 SHA。');
  }
  const file = resolve(baselineRoot, entry.path);
  if (!file.startsWith(`${baselineRoot}/`) || paths.has(entry.path) || !existsSync(file)) {
    throw new Error(`审查记录缺图、越界或重复：${entry.path}`);
  }
  paths.add(entry.path);
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (sha256 !== entry.sha256) throw new Error(`已审查 PNG 被修改：${entry.path}`);
  const locale = /\/ios\/iphone16-ios18\.5\/(en|zh-Hans|zh-Hant)\/(page|animation|asset)\//.exec(`/${entry.path}`)?.[1];
  if (!locale) throw new Error(`审查记录不符合 iOS v1 目录：${entry.path}`);
  if (entry.path.includes('/animation/') && locale !== 'en') {
    throw new Error(`动画基准只允许英文：${entry.path}`);
  }
  reviewedLocales.add(locale);
}
function* pngFiles(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${item.name}`;
    if (item.isDirectory()) yield* pngFiles(file);
    else if (item.isFile() && item.name.endsWith('.png')) yield relative(baselineRoot, file);
  }
}
for (const file of pngFiles(baselineRoot)) if (!paths.has(file)) throw new Error(`未审查 PNG 混入基准：${file}`);
// 一次列出本轮所有缺失项，避免补完一个分片后才发现下一个；仍在分配原生 runner 前失败。
const missingBaselines = [];
const missingInventoryCases = [];
for (const item of matrix.include.filter(item => item.animation)) {
  const entry = animationCase(item.animation);
  if (!item.recordOnly && !entry.images.length) {
    missingInventoryCases.push(entry.id);
    missingBaselines.push(`${entry.id} 缺少完整审查后的动画基准清单：${entry.title}`);
  }
  for (const image of (item.recordOnly ? entry.images.filter(name => name.startsWith('en-')) : entry.images)) {
    const path = baselineRelativePath(image, 'en');
    if (!paths.has(path)) missingBaselines.push(`${item.recordOnly ? '静态截图' : '动画门禁'}缺少基准：${path}（${entry.title}）`);
  }
}
for (const item of matrix.include.filter(item => item.group === 'guest' && !item.animation)) {
  for (const test of guestScreenshotTests(item.locale, item.shard)) {
    for (const image of test.images) {
      const path = baselineRelativePath(image, item.locale);
      if (!paths.has(path)) missingBaselines.push(`游客验收清单缺少基准：${path}（${test.title}）`);
    }
  }
}
if (missingBaselines.length) {
  // Only an otherwise valid baseline with solely incomplete inventory may
  // start a reference capture. Hash or provenance failures never do.
  if (process.env.GITHUB_OUTPUT && missingBaselines.length === missingInventoryCases.length) {
    appendFileSync(process.env.GITHUB_OUTPUT, `reference_cases=${missingInventoryCases.join(',')}\n`);
  }
  throw new Error(`compare 基准预检失败：\n${missingBaselines.join('\n')}`);
}
for (const locale of locales) {
  if (!['en', 'zh-Hans', 'zh-Hant'].includes(locale)) throw new Error(`未知 iOS 基准语言：${locale}`);
  if (!reviewedLocales.has(locale)) throw new Error(`compare 缺少已审查的 ${locale} PNG 基准：${baselineRoot}`);
}
console.log(`已验证 ${review.files.length} 张原始 PNG 与人工审查记录；本轮语言：${[...locales].join(', ')}。`);
