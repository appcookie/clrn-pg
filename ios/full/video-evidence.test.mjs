import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportVideoEvidence } from './video-evidence.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ios-video-export-'));
  const artifact = join(root, 'artifact'), output = join(root, 'output');
  mkdirSync(join(artifact, 'full-results'), { recursive: true });
  mkdirSync(join(artifact, 'release'));
  const bytes = Buffer.from('0000ftypisom-original-video');
  const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
  writeFileSync(join(artifact, 'full-results/clip.mp4'), bytes);
  writeFileSync(join(artifact, 'release/build-info.json'), JSON.stringify({ applicationCommit: 'a'.repeat(40) }));
  const attachments = [
    { name: 'toast-native-video', contentType: 'video/mp4', path: '/runner/clip.mp4' },
    { name: 'keyframe', contentType: 'image/png', body: png.toString('base64') },
    { name: 'toast-video-keyframes', contentType: 'application/json', body: Buffer.from(JSON.stringify([
      { attachment: 'keyframe', timestampMs: 125 },
    ])).toString('base64') },
  ];
  const report = { suites: [{ specs: [{ title: 'toast', tests: [{ results: [{ status: 'failed', attachments }] }] }] }] };
  const save = () => writeFileSync(join(artifact, 'full-results/report.json'), JSON.stringify(report)); save();
  return { root, artifact, output, bytes, png, attachments, report, save };
}

test('失败运行导出原始MP4与实际PTS关键帧，保留失败状态和应用身份', () => {
  const f = fixture();
  try {
    const m = exportVideoEvidence(f.artifact, f.output, { run: '123' });
    assert.equal(m.videos[0].status, 'failed'); assert.equal(m.videos[0].keyframeKind, 'asserted');
    assert.equal(m.videos[0].keyframes[0].timestampMs, 125);
    assert.deepEqual(readFileSync(join(f.output, '001.mp4')), f.bytes);
    assert.deepEqual(readFileSync(join(f.output, '001-1.png')), f.png);
    assert.match(m.videos[0].sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => exportVideoEvidence(f.artifact, f.output), /覆盖/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('旧录像没有关键帧时仍可回看，不伪造图片或通过状态', () => {
  const f = fixture();
  try {
    f.attachments.splice(1); f.save();
    const m = exportVideoEvidence(f.artifact, f.output);
    assert.deepEqual(m.videos[0].keyframes, []); assert.equal(m.videos[0].keyframeKind, 'preview');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
for (const mode of ['missing-video', 'missing-image', 'duplicate-video', 'bad-time', 'bad-build'])
  test(`损坏或不完整产物不能导出为完整证据：${mode}`, () => {
    const f = fixture();
    try {
      if (mode === 'missing-video') rmSync(join(f.artifact, 'full-results/clip.mp4'));
      if (mode === 'missing-image') f.attachments.splice(1, 1);
      if (mode === 'duplicate-video') {
        mkdirSync(join(f.artifact, 'full-results/other'));
        writeFileSync(join(f.artifact, 'full-results/other/clip.mp4'), f.bytes);
      }
      if (mode === 'bad-time') f.attachments[2].body = Buffer.from(JSON.stringify([{ attachment: 'keyframe', timestampMs: -0.5 }])).toString('base64');
      if (mode === 'bad-build') writeFileSync(join(f.artifact, 'release/build-info.json'), '{}');
      f.save(); assert.throws(() => exportVideoEvidence(f.artifact, f.output));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });


test('同名多次录屏只关联各自后续关键帧，不能混用第一片的证据', () => {
  const f = fixture();
  try {
    const second = f.attachments.map(a => ({ ...a }));
    second[0].path = '/runner/second.mp4';
    const otherPng = Buffer.from(f.png); otherPng[otherPng.length - 1] = 9;
    second[1].body = otherPng.toString('base64');
    second[2].body = Buffer.from(JSON.stringify([{ attachment: 'keyframe', timestampMs: 375 }])).toString('base64');
    writeFileSync(join(f.artifact, 'full-results/second.mp4'), f.bytes);
    f.attachments.push(...second); f.save();
    const m = exportVideoEvidence(f.artifact, f.output);
    assert.equal(m.videos.length, 2);
    assert.equal(m.videos[0].keyframes[0].timestampMs, 125);
    assert.equal(m.videos[1].keyframes[0].timestampMs, 375);
    assert.deepEqual(readFileSync(join(f.output, '001-1.png')), f.png);
    assert.deepEqual(readFileSync(join(f.output, '002-1.png')), otherPng);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
