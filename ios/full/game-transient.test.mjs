import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { captureToast } from './game-transient.ts';
import { toastKeyframes } from './toast-keyframes.ts';
import { samePixels } from './motion-regions.ts';

function setup(mode = 'stable') {
  const bounds = { x: 0, y: 0, width: 4, height: 4 };
  const image = value => { const png = new PNG({ width: 4, height: 4 }); png.data.fill(value); return PNG.sync.write(png); };
  const background = image(255), original = image(100);
  const frames = [background, original, mode === 'moving' ? image(0) : original, original, background];
  frames.timestampsMs = [0, 100, 250, 450, 600];
  const attachments = [], calls = [];
  const device = { screenSize: { width: 4, height: 4 },
    inputObservation: async () => { throw new Error('不应在短提示窗口查询节点'); },
    screenshot: async () => { throw new Error('不应在短提示窗口截屏'); },
  };
  const record = async (_device, _name, _region, trigger) => {
    calls.push('record-start'); await trigger(); calls.push('record-stop'); return frames;
  };
  const trigger = async () => { calls.push('trigger'); return mode === 'wrong' ? 'other' : 'explanation'; };
  const recognize = async images => { calls.push('recognize-keyframes'); assert.equal(images.length, 3);
    return images.map(() => mode === 'absent' ? [] : [{ text: 'explanation', confidence: 1,
      bounds: { x: 0, y: 0, width: 1, height: 1 } }]); };
  const locate = async () => ({ bounds, frameIndices: [1, 2, 3], panels: [bounds, bounds, bounds] });
  return { original, frames, attachments, calls, device, record, trigger, recognize, locate,
    info: { attach: async (name, value) => attachments.push({ name, ...value }) } };
}

test('先录像再触发一次：停止后只识别原始PTS的三帧，保留同名基准', async () => {
  const previous = process.env.IOS_VISUAL_MODE; process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    const s = setup();
    await captureToast(s.device, 'unit-toast', s.info, [], s.trigger, s.record, s.recognize, s.locate);
    assert.deepEqual(s.calls, ['record-start', 'trigger', 'record-stop', 'recognize-keyframes']);
    assert.deepEqual(s.attachments.find(a => a.name === 'unit-toast.png').body, s.original);
    const frames = JSON.parse(s.attachments.find(a => a.name === 'unit-toast-video-keyframes').body);
    assert.deepEqual(frames.map(f => f.timestampMs), [100, 250, 450]);
    for (const f of frames) assert.deepEqual(s.attachments.find(a => a.name === f.attachment).body, s.original);
  } finally { if (previous === undefined) delete process.env.IOS_VISUAL_MODE; else process.env.IOS_VISUAL_MODE = previous; }
});
for (const [mode, error] of [['absent', /实际显示预期文字/], ['wrong', /other/], ['moving', /稳定至少 250/]])
  test(`录像不能掩盖 ${mode}`, async () => {
    const s = setup(mode); await assert.rejects(captureToast(s.device, 'toast', s.info, [], s.trigger, s.record, s.recognize, s.locate), error);
  });
test('背景、时间戳倒退和短片段不能冒充稳定可见提示', async () => {
  const s = setup(); const bounds = { x: 0, y: 0, width: 4, height: 4 };
  s.frames.fill(s.frames[0]);
  await assert.rejects(toastKeyframes(s.frames, bounds, []), /稳定至少 250/);
  s.frames.timestampsMs = [0, 100, 90, 300, 600];
  await assert.rejects(toastKeyframes(s.frames, bounds, []), /时间戳/);
  const fast = setup().frames; fast.timestampsMs = [0, 100, 150, 200, 300];
  await assert.rejects(toastKeyframes(fast, bounds, []), /稳定至少 250/);
});

test('真实录像的三张静止提示容许既有截图规则内的编码噪声，仍排除背景', async () => {
  const root = new URL('./fixtures/recorded-toast/', import.meta.url);
  const source = JSON.parse(readFileSync(new URL('source.json', root)));
  const frames = source.files.map(file => readFileSync(new URL(file.file, root)));
  frames.timestampsMs = source.files.map(file => file.timestampMs);
  assert.equal(samePixels(frames[1], frames[2]), false);
  assert.deepEqual(await toastKeyframes(frames, source.panel, [], [1, 2, 3]), [1, 2, 3]);
  await assert.rejects(toastKeyframes(frames, source.panel, [], [1, 2]), /稳定至少 250/);
});
