import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { captureToast } from './game-transient.ts';

function setup(t, mode = 'stable') {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const bounds = { x: 0, y: 0, width: 4, height: 4 };
  const png = new PNG({ width: 4, height: 4 }); png.data.fill(255);
  const original = PNG.sync.write(png);
  const attachments = [];
  let queries = 0, screenshots = 0;
  return { original, attachments, device: {
    transientMarkerReader(res) { return () => this.transientMarker(res); },
    transientMarker: async res => {
      t.mock.timers.tick(100);
      if (Date.now() > 2600) return null;
      if (res === 'toast-container') return { res, bounds };
      queries++;
      if (mode === 'disappeared' && queries === 2) return null;
      return { res, bounds, text: mode === 'changed-text' && queries % 2 === 0 ? 'different' : 'explanation' };
    },
    screenshot: async () => {
      screenshots++; t.mock.timers.tick(mode === 'variable' ? ([416, 183, 183][screenshots - 1] ?? 300) : 300);
      if (mode === 'moving' && screenshots % 2 === 0) {
        const dark = PNG.sync.read(original); dark.data.fill(0); return PNG.sync.write(dark);
      }
      return original;
    },
    nativeScreenshot: async () => { throw new Error('不应为短提示另起simctl截图进程'); },
  }, info: { attach: async (name, value) => attachments.push({ name, ...value }) } };
}

test('会话无损截图仍要求两个实际可见帧及250毫秒未遮罩稳定性', async t => {
  const previous = process.env.IOS_VISUAL_MODE; process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    const { device, info, original, attachments } = setup(t);
    await captureToast(device, 'unit-toast', info, [], 'explanation');
    assert.deepEqual(attachments.find(a => a.name === 'unit-toast.png').body, original);
    assert.ok(attachments.filter(a => a.name.endsWith('-original')).length >= 2);
    assert.ok(attachments.some(a => a.name === 'unit-toast-capture-timing'));
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE; else process.env.IOS_VISUAL_MODE = previous;
  }
});

test('首张截图较慢不能冒充250毫秒稳定跨度，继续采集第三张真实画面', async t => {
  const previous = process.env.IOS_VISUAL_MODE; process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    const { device, info, attachments } = setup(t, 'variable');
    await captureToast(device, 'variable-toast', info, [], 'explanation');
    const frames = JSON.parse(attachments.find(a => a.name === 'variable-toast-frames').body);
    assert.equal(frames.length, 3);
    assert.equal(frames[1].capturedAt - frames[0].capturedAt, 183);
    assert.equal(frames[2].capturedAt - frames[0].capturedAt, 366);
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE; else process.env.IOS_VISUAL_MODE = previous;
  }
});

for (const [mode, message] of [['disappeared', /至少两帧/], ['changed-text', /文字必须保持一致/], ['moving', /稳定至少 250/]]) {
  test(`短提示${mode}不能成为通过截图`, async t => {
    const { device, info } = setup(t, mode);
    await assert.rejects(captureToast(device, 'unit-toast', info, [], 'explanation'), message);
  });
}
