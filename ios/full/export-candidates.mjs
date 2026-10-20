// 从已通过的 Playwright CI 报告无损导出截图候选；不会修改已提交的视觉基准。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { baselineRelativePath } from './baseline-path.mjs';

const [outputArgument, ...artifactArguments] = process.argv.slice(2);
if (!outputArgument || !artifactArguments.length) {
  throw new Error('用法：node ios/full/export-candidates.mjs <新目录> <已下载的 CI artifact 目录>...');
}
const output = resolve(outputArgument);
if (existsSync(output)) throw new Error(`候选目录已存在，不覆盖：${output}`);
const candidates = new Map();
let buildIdentity;
let testCount = 0;

function candidatePaths(name, artifact) {
  const prefix = /^(zh-Hans|zh-Hant|en)-(.+)\.png$/.exec(name);
  const locale = prefix?.[1] || /-(zh-Hans|zh-Hant|en)-/.exec(artifact)?.[1];
  if (!locale) throw new Error(`无法从报告附件确定语言：${artifact}/${name}`);
  return { unified: join('v1', baselineRelativePath(name, locale)), locale };
}

function* results(suite) {
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      for (const result of test.results || []) yield { test, result };
    }
  }
  for (const child of suite.suites || []) yield* results(child);
}

for (const argument of artifactArguments) {
  const artifact = resolve(argument);
  const root = existsSync(join(artifact, 'full-results/report.json')) ? artifact : join(artifact, 'artifacts');
  const report = JSON.parse(readFileSync(join(root, 'full-results/report.json'), 'utf8'));
  const build = JSON.parse(readFileSync(join(root, 'release/build-info.json'), 'utf8'));
  const identity = `${build.applicationCommit}:${build.package?.sha256}`;
  if (!buildIdentity) buildIdentity = { identity, build };
  if (identity !== buildIdentity.identity) throw new Error(`不同发布包的截图不能混合：${artifact}`);
  if (!report.stats?.expected || report.stats.unexpected || report.stats.flaky || report.stats.skipped) {
    throw new Error(`只接受全部通过的 CI 报告：${artifact}`);
  }
  let artifactTests = 0;
  for (const { test, result } of report.suites.flatMap(suite => [...results(suite)])) {
    artifactTests++;
    if (result.status !== 'passed' || test.status !== 'expected') {
      throw new Error(`报告含未通过测试：${artifact}`);
    }
    for (const attachment of result.attachments || []) {
      if (attachment.contentType !== 'image/png' || !attachment.name
        || !/(\.png|-(start|middle|end))$/.test(attachment.name)) continue;
      const name = attachment.name.endsWith('.png') ? attachment.name : `${attachment.name}.png`;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(name) || name.includes('..')) {
        throw new Error(`截图文件名无效：${name}`);
      }
      if (!attachment.body || attachment.path) throw new Error(`截图没有内联原始 PNG：${name}`);
      const bytes = Buffer.from(attachment.body, 'base64');
      const picture = PNG.sync.read(bytes);
      if (picture.width < 1 || picture.height < 1) throw new Error(`截图尺寸无效：${name}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const previous = candidates.get(name);
      if (previous && previous.sha256 !== sha256) throw new Error(`同名候选截图不一致：${name}`);
      candidates.set(name, { name, bytes, sha256, width: picture.width, height: picture.height,
        artifact: basename(artifact), ...candidatePaths(name, basename(artifact)) });
    }
  }
  if (artifactTests !== report.stats.expected) throw new Error(`报告测试计数不符：${artifact}`);
  testCount += artifactTests;
}
if (!candidates.size) throw new Error('CI 报告没有可导出的 PNG 截图。');
const uniquePaths = new Map();
for (const candidate of candidates.values()) {
  const previous = uniquePaths.get(candidate.unified);
  if (previous && previous.sha256 !== candidate.sha256) {
    throw new Error(`同一统一场景收到不同画面：${previous.name} / ${candidate.name}`);
  }
  uniquePaths.set(candidate.unified, candidate);
}
mkdirSync(output, { recursive: true });
for (const candidate of uniquePaths.values()) {
  const path = join(output, candidate.unified);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, candidate.bytes);
}
writeFileSync(join(output, 'v1/build-info.json'), JSON.stringify(buildIdentity.build, null, 2) + '\n');
writeFileSync(join(output, 'candidate-manifest.json'), JSON.stringify({
  status: 'unreviewed',
  sourceArtifacts: artifactArguments.map(argument => basename(resolve(argument))),
  build: buildIdentity.build,
  passedTests: testCount,
  files: [...candidates.values()].map(({ name, sha256, width, height, artifact, unified }) =>
    ({ name, sha256, width, height, artifact, unifiedPath: unified }))
    .sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2) + '\n');
console.log(`导出 ${candidates.size} 张真实截图候选（${testCount} 个通过测试），对应 ${uniquePaths.size} 张统一 v1 PNG：${output}`);
