// 从本次通过的真实报告导出原始截图；不把新截图自动批准为基准。
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { baselineRelativePath } from './baseline-path.mjs';
import { guestScreenshotTests, reportSpecs, screenshotTestKey } from './guest-screenshot-contract.mjs';

export function validateScreenshotReport(report, locale, shard) {
  const required = guestScreenshotTests(locale, shard);
  const specs = [...reportSpecs(report)];
  if (report.stats?.expected !== required.length || report.stats.unexpected !== 0
    || report.stats.skipped !== 0 || report.stats.flaky !== 0) {
    throw new Error('截图报告必须全部通过且无跳过，测试数量必须符合游客验收清单');
  }
  const byKey = new Map(specs.map(spec => [screenshotTestKey(spec), spec]));
  if (specs.length !== required.length || byKey.size !== specs.length) throw new Error('截图报告测试重复或数量不符');
  return required.map(expected => {
    const spec = byKey.get(screenshotTestKey(expected));
    const test = spec?.tests?.[0], result = test?.results?.[0];
    if (!spec || spec.tests.length !== 1 || test.status !== 'expected'
      || test.expectedStatus !== 'passed' || test.results.length !== 1 || result.status !== 'passed') {
      throw new Error(`缺少本轮通过的测试：${expected.title}`);
    }
    const attachments = result.attachments || [];
    const images = expected.images.map(name => {
      // compare 的转场附件没有 .png 后缀；reference/smoke 的同一张图可能重复附加。
      const matches = attachments.filter(a => a.contentType === 'image/png'
        && a.name.replace(/\.png$/, '') === name.slice(0, -4));
      if (!matches.length) throw new Error(`缺少本轮截图：${name}`);
      const pictures = matches.map(a => {
        if (!a.body || a.path) throw new Error(`缺少内联原始 PNG：${name}`);
        const bytes = Buffer.from(a.body, 'base64');
        const picture = PNG.sync.read(bytes, { checkCRC: true });
        if (!picture.width || !picture.height) throw new Error(`截图尺寸无效：${name}`);
        return { bytes, width: picture.width, height: picture.height,
          sha256: createHash('sha256').update(bytes).digest('hex') };
      });
      if (pictures.some(p => p.sha256 !== pictures[0].sha256)) throw new Error(`同名截图不一致：${name}`);
      return { name, ...pictures[0], path: join('v1', baselineRelativePath(name, locale)), test: expected.title };
    });
    const videos = attachments.filter(a => a.contentType === 'video/mp4');
    for (const name of expected.videos || []) {
      if (!videos.some(a => a.name === name)) throw new Error(`缺少本轮录屏：${name}`);
    }
    for (const prefix of expected.videoPrefixes || []) {
      if (!videos.some(a => a.name.startsWith(prefix) && a.name.endsWith('-native-video'))) {
        throw new Error(`缺少本轮录屏：${prefix}`);
      }
    }
    for (const name of expected.json || []) {
      const attachment = attachments.find(a => a.name === name && a.contentType === 'application/json');
      if (!attachment?.body || !JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'))) {
        throw new Error(`缺少素材检查证据：${name}`);
      }
    }
    return { images, videos, test: expected.title };
  });
}

export function exportScreenshotEvidence(artifactDirectory, outputDirectory, locale, shard, source = {}) {
  const artifact = resolve(artifactDirectory), output = resolve(outputDirectory);
  if (existsSync(output)) throw new Error(`输出目录已存在，不覆盖：${output}`);
  const report = JSON.parse(readFileSync(join(artifact, 'full-results/report.json'), 'utf8'));
  const build = JSON.parse(readFileSync(join(artifact, 'release/build-info.json'), 'utf8'));
  if (build.platform !== 'ios' || build.packageKind !== 'simulator'
    || !/^[a-f0-9]{40}$/.test(build.applicationCommit || '')
    || !/^[a-f0-9]{64}$/.test(build.package?.sha256 || '')) throw new Error('截图缺少有效的发布包构建身份');
  const results = validateScreenshotReport(report, locale, shard);
  // Playwright 在 JSON 中保留 runner 绝对路径；只允许从下载产物内按唯一文件名重定位。
  const videoFiles = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mp4')) {
        videoFiles.set(entry.name, [...(videoFiles.get(entry.name) || []), path]);
      }
    }
  }
  visit(join(artifact, 'full-results'));
  const images = results.flatMap(result => result.images);
  const videos = results.flatMap(result => result.videos.map(a => {
    if (!a.path || !/^[A-Za-z0-9_-]+$/.test(a.name)) throw new Error('录屏附件路径或名称无效');
    const matches = videoFiles.get(basename(a.path)) || [];
    if (matches.length !== 1) throw new Error(`录屏附件文件缺失或重复：${a.name}`);
    const bytes = readFileSync(matches[0]);
    if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error(`录屏内容无效：${a.name}`);
    return { name: a.name, path: join('videos', `${a.name}.mp4`), bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'), test: result.test };
  }));
  const files = [...images, ...videos];
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('截图/录像输出路径重复');
  // 所有检查完成后才写产物，失败时不会发布看似完整的截图集。
  mkdirSync(output, { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(output, file.path)), { recursive: true });
    writeFileSync(join(output, file.path), file.bytes);
  }
  writeFileSync(join(output, 'v1/build-info.json'), JSON.stringify(build, null, 2) + '\n');
  const manifest = { status: 'captured-not-reviewed', group: 'guest', locale, shard,
    source, build, passedTests: results.length, screenshots: images.length,
    files: files.map(({ bytes, ...file }) => ({ ...file, size: bytes.length })) };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  writeFileSync(join(output, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>iOS 本轮截图</title>
<style>body{font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}figure{margin:0}img{max-width:100%;max-height:600px}figcaption{overflow-wrap:anywhere}</style>
<h1>iOS 游客截图 · ${locale} · ${shard}</h1>
<p>${results.length} 项测试通过，${images.length} 张本轮截图。新截图尚未批准为基准。</p>
<p><a href="manifest.json">来源、构建身份及 SHA-256</a></p><main>
${images.map(file => `<figure><a href="${file.path}"><img loading="lazy" src="${file.path}" alt="${escape(file.name)}"></a><figcaption>${escape(file.name)}</figcaption></figure>`).join('\n')}
</main><h2>本轮录屏</h2><ul>${videos.map(file => `<li><a href="${file.path}">${escape(file.name)}</a></li>`).join('')}</ul></html>\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [artifact, output, locale, shard] = process.argv.slice(2);
  if (!artifact || !output || !locale || !shard) {
    throw new Error('用法：node ios/full/screenshot-evidence.mjs <产物根目录> <新输出目录> <语言> <分片>');
  }
  const manifest = exportScreenshotEvidence(artifact, output, locale, shard, {
    workflowHead: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    url: process.env.GITHUB_RUN_ID && `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
  console.log(`已验证并导出 ${manifest.screenshots} 张本轮原始截图，${manifest.passedTests} 项测试全部通过：${output}`);
}
