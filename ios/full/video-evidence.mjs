// 导出可移植的原始录像与真实关键帧；失败运行仍保留明确的失败状态，绝不批准基准。
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reportSpecs } from './guest-screenshot-contract.mjs';

export function exportVideoEvidence(artifactDirectory, outputDirectory, source = {}) {
  const artifact = resolve(artifactDirectory), output = resolve(outputDirectory);
  if (existsSync(output)) throw new Error('不覆盖已有视频证据');
  const report = JSON.parse(readFileSync(join(artifact, 'full-results/report.json'), 'utf8'));
  const build = JSON.parse(readFileSync(join(artifact, 'release/build-info.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(build.applicationCommit || '')) throw new Error('录像缺少应用提交');
  const files = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.set(entry.name, [...(files.get(entry.name) || []), file]);
    }
  }
  visit(join(artifact, 'full-results'));
  function attachmentBytes(attachment) {
    if (attachment.body) return Buffer.from(attachment.body, 'base64');
    const matches = files.get(basename(attachment.path || '')) || [];
    if (matches.length !== 1) throw new Error(`附件缺失或重名：${attachment.name}`);
    return readFileSync(matches[0]);
  }
  const manifest = { schemaVersion: 1, run: String(source.run || 'local'), applicationCommit: build.applicationCommit,
    source, build, videos: [] };
  const pending = [];
  for (const spec of reportSpecs(report)) for (const test of spec.tests || []) for (const result of test.results || []) {
    const attachments = result.attachments || [];
    for (const video of attachments.filter(a => a.contentType === 'video/mp4')) {
      const name = video.name.replace(/-native-video$/, '');
      const id = String(manifest.videos.length + 1).padStart(3, '0');
      const bytes = attachmentBytes(video);
      if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('录像不是有效的 MP4 容器');
      const entry = { name, status: result.status, path: `${id}.mp4`, sha256: digest(bytes), keyframes: [],
        keyframeKind: 'preview', test: spec.title };
      if (!['passed', 'failed', 'timedOut', 'interrupted', 'skipped'].includes(entry.status)) throw new Error('未知测试结果');
      pending.push({ path: entry.path, bytes });
      const verified = attachments.find(a => a.name === `${name}-video-keyframes`);
      const metadata = verified || attachments.find(a => a.name === `${name}-video-preview-keyframes`);
      if (verified) entry.keyframeKind = 'asserted';
      let previous = -1;
      for (const frame of metadata ? JSON.parse(attachmentBytes(metadata).toString('utf8')) : []) {
        if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= previous) throw new Error('关键帧时间戳必须递增');
        previous = frame.timestampMs;
        const image = attachments.find(a => a.name === frame.attachment && a.contentType === 'image/png');
        if (!image) throw new Error('关键帧原图缺失');
        const png = attachmentBytes(image);
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('关键帧不是PNG');
        const file = { path: `${id}-${entry.keyframes.length + 1}.png`, timestampMs: frame.timestampMs, sha256: digest(png) };
        entry.keyframes.push(file); pending.push({ path: file.path, bytes: png });
      }
      manifest.videos.push(entry);
    }
  }
  mkdirSync(output, { recursive: true });
  for (const file of pending) writeFileSync(join(output, file.path), file.bytes);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  copyFileSync(join(artifact, 'release/build-info.json'), join(output, 'build-info.json'));
  return manifest;
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [artifact, output] = process.argv.slice(2);
  if (!artifact || !output) throw new Error('用法：node ios/full/video-evidence.mjs <产物根目录> <新输出目录>');
  const manifest = exportVideoEvidence(artifact, output, { run: process.env.GITHUB_RUN_ID,
    workflowHead: process.env.GITHUB_SHA, attempt: process.env.GITHUB_RUN_ATTEMPT });
  console.log(`已保留 ${manifest.videos.length} 段原始视频及同次运行关键帧；详见各项测试状态。`);
}
