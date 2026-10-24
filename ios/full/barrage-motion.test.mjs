import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { barrageTargets, captureBarrageMotion } from './barrage-motion.ts';
import { cropMotionRegion } from './motion-regions.ts';

const size = { width: 160, height: 100 };
const bounds = { x: 124, y: 31, width: 24, height: 10 };
const region = { x: 0, y: 23, width: 160, height: 26 };
const relativeBounds = { ...bounds, y: bounds.y - region.y };
function picture(left, { letters = true, color = [1, 34, 32], width = 34, height = 12, top = 30 } = {}) {
  const png = new PNG(size);
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    let rgb = [20 + x % 5, 100 + y % 7, 65];
    if (left !== undefined && x >= left && x < left + width && y >= top && y < top + height) {
      rgb = color;
      if (letters && x >= left + 5 && x < left + 29 && x % 3 !== 0 && y >= top + 3 && y < top + 9) rgb = [255, 255, 255];
    }
    png.data.set([...rgb, 255], (y * size.width + x) * 4);
  }
  return PNG.sync.write(png);
}
const empty = picture();
const moving = Array.from({ length: 15 }, (_, index) => picture(120 - index * 6));

test('弹幕识别要求原生横带内完整深绿底白字连通目标，排除空态和背景运动', async () => {
  const crop = bytes => cropMotionRegion(bytes, region);
  assert.equal((await barrageTargets(crop(empty), moving.map(crop), relativeBounds)).length, 15);
  for (const frames of [Array(15).fill(empty),
    Array.from({ length: 15 }, (_, index) => picture(120 - index * 6, { letters: false })),
    Array.from({ length: 15 }, (_, index) => picture(120 - index * 6, { color: [100, 80, 20] })),
    Array.from({ length: 15 }, (_, index) => picture(50 - index * 2, { width: 100 })),
    Array.from({ length: 15 }, (_, index) => picture(120 - index * 6, { top: 27 })),
    Array.from({ length: 15 }, (_, index) => picture(120 - index * 6, { height: 35, top: 0 })),
    Array.from({ length: 15 }, (_, index) => picture(155 - index / 10))]) {
    assert.deepEqual(await barrageTargets(crop(empty), frames.map(crop), relativeBounds), []);
  }
});

test('先录原片再单次发送，精准读取一次文字，现有移动门禁只接收同片可见弹幕帧', async () => {
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    const run = async (frames, { text = 'Player1: Good hand!', error } = {}) => {
      let recording = false, sends = 0, queries = 0;
      const attachments = new Map();
      const device = { screenSize: size, nativeScreenshot: async () => {
        assert.equal(sends, 0); return empty;
      }, transientMarker: async marker => {
        queries++;
        assert.equal(marker, 'barrage_text');
        assert.equal(recording, true);
        assert.equal(sends, 1);
        assert.equal(queries, 1, '不重复整树等待短时标签');
        if (error) throw error;
        return { res: marker, text, bounds };
      } };
      const operation = captureBarrageMotion(device, { attach: async (name, value) => attachments.set(name, value) },
        async () => { assert.equal(recording, true); sends++; }, 'Player1: Good hand!',
        async (_device, name, _info, trigger, duration) => {
          assert.equal(name, 'texas-barrage');
          assert.equal(sends, 0);
          assert.equal(duration, 5000);
          recording = true;
          await trigger();
          recording = false;
          return [empty, empty, ...frames, empty].map((bytes, index) => ({ capturedAt: index * 30, png: bytes.toString('base64') }));
        });
      return { operation, attachments, counts: () => ({ sends, queries }) };
    };
    const success = await run(moving);
    await success.operation;
    assert.deepEqual(success.counts(), { sends: 1, queries: 1 });
    const first = success.attachments.get('texas-barrage-1-first.png').body;
    assert.deepEqual(PNG.sync.read(first).data, PNG.sync.read(cropMotionRegion(moving[0], region)).data,
      'first 必须来自真实可见弹幕帧，不能使用录前空帧');
    assert.deepEqual(JSON.parse(success.attachments.get('texas-barrage-trigger-timing').body).map(item => item.phase),
      ['send-start', 'send-complete', 'text-observed']);
    for (const frames of [Array(15).fill(picture(90)),
      Array.from({ length: 30 }, (_, index) => index % 2 ? picture(90) : empty),
      Array(15).fill(empty)]) {
      const failure = await run(frames);
      await assert.rejects(failure.operation, /向左移动|完整白字弹幕帧/);
      assert.deepEqual(failure.counts(), { sends: 1, queries: 1 });
      assert.equal(failure.attachments.has('texas-barrage-1-first.png'), false);
    }
    for (const options of [{ text: 'Wrong message' }, { error: new Error('native query failed') }]) {
      const failure = await run(moving, options);
      await assert.rejects(failure.operation, /准确消息|native query failed/);
      assert.deepEqual(failure.counts(), { sends: 1, queries: 1 });
      assert.equal(failure.attachments.has('texas-barrage-trigger-timing'), true);
    }
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});
