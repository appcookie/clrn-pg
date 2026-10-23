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
    const clips = attachments.map((attachment, index) => ({ attachment, index }))
      .filter(({ attachment }) => attachment.contentType === 'video/mp4');
    for (const [clipIndex, { attachment: video, index }] of clips.entries()) {
      // 循环动画可有同名的独立录屏窗口；只关联本片之后、下一片之前的附件。
      // 不能用全报告 find(name) 把第一片的帧挂到后续同名视频上。
      const clipAttachments = attachments.slice(index + 1, clips[clipIndex + 1]?.index ?? attachments.length);
      const name = video.name.replace(/-native-video$/, '');
      const id = String(manifest.videos.length + 1).padStart(3, '0');
      const bytes = attachmentBytes(video);
      if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('录像不是有效的 MP4 容器');
      const entry = { name, status: result.status, path: `${id}.mp4`, sha256: digest(bytes), keyframes: [],
        keyframeKind: 'preview', test: spec.title };
      if (!['passed', 'failed', 'timedOut', 'interrupted', 'skipped'].includes(entry.status)) throw new Error('未知测试结果');
      pending.push({ path: entry.path, bytes });
      const verified = clipAttachments.find(a => a.name === `${name}-video-keyframes`);
      const metadata = verified || clipAttachments.find(a => a.name === `${name}-video-preview-keyframes`);
      if (verified) entry.keyframeKind = 'asserted';
      let previous = -1, previousFrameIndex = -1;
      for (const frame of metadata ? JSON.parse(attachmentBytes(metadata).toString('utf8')) : []) {
        if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= previous) throw new Error('关键帧时间戳必须递增');
        previous = frame.timestampMs;
        const image = clipAttachments.find(a => a.name === frame.attachment && a.contentType === 'image/png');
        if (!image) throw new Error('关键帧原图缺失');
        const png = attachmentBytes(image);
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('关键帧不是PNG');
        if (frame.frameIndex !== undefined && (!Number.isSafeInteger(frame.frameIndex) || frame.frameIndex <= previousFrameIndex))
          throw new Error('关键帧原始帧序无效');
        if (frame.frameIndex !== undefined) previousFrameIndex = frame.frameIndex;
        const file = { path: `${id}-${entry.keyframes.length + 1}.png`, timestampMs: frame.timestampMs,
          ...(frame.frameIndex === undefined ? {} : { frameIndex: frame.frameIndex }), sha256: digest(png) };
        entry.keyframes.push(file); pending.push({ path: file.path, bytes: png });
      }
      manifest.videos.push(entry);
    }
  }
  mkdirSync(output, { recursive: true });
  for (const file of pending) writeFileSync(join(output, file.path), file.bytes);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  writeFileSync(join(output, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>iOS 动画录屏</title>
<style>body{font:16px system-ui;margin:24px;max-width:1100px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{min-width:0}video{width:100%}h2,p{overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>
<h1>iOS 动画录屏</h1><p>本页供人工观看动画；页面截图由 CI 单独比较。<a href="manifest.json">查看录制来源与校验值</a></p>
<main>${manifest.videos.map(clip => `<article><h2>${escape(clip.name)}</h2>
<video controls playsinline preload="metadata" src="${clip.path}"></video>
<p>${escape(clip.test)} · ${escape(clip.status)} · <a href="${clip.path}">下载 MP4</a></p>
${clip.keyframes.map(frame => `<a href="${frame.path}"><img loading="lazy" src="${frame.path}" alt="${escape(clip.name)} ${frame.timestampMs} ms"></a>`).join('')}
</article>`).join('')}</main></html>\n`);
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
