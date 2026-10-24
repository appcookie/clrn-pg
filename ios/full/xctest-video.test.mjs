import test from 'node:test';
import assert from 'node:assert/strict';
import { captureXCTestRecording } from './xctest-video.ts';

const metadata = { uuid: 'capture-1', fps: 60, startedAt: 123456, codec: 0 };
const movie = Buffer.alloc(20); movie.write('ftyp', 4);
function device(overrides = {}) {
  const events = [];
  return { events, async execute(method, args) {
    events.push([method, args]);
    if (Object.hasOwn(overrides, method)) return overrides[method];
    if (method === 'mobile: getXCTestScreenRecordingInfo') return null;
    if (method === 'mobile: startXCTestScreenRecording') return metadata;
    if (method === 'mobile: stopXCTestScreenRecording') return { ...metadata, payload: movie.toString('base64') };
    throw Error(method);
  } };
}
test('XCTest 录屏必须在动作前启动，保存原始字节和本轮标识；动作失败仍停止并保留录像', async () => {
  for (const failAction of [false, true]) {
    const native = device(); let saved = false;
    const action = async () => {
      assert.deepEqual(native.events.at(-1), ['mobile: startXCTestScreenRecording', { fps: 60 }]);
      if (failAction) throw Error('actual UI failure');
    };
    const work = captureXCTestRecording(native, action, 0, async capture => {
      saved = true; assert.deepEqual(capture.bytes, movie);
      assert.equal(capture.end.uuid, metadata.uuid);
      assert.ok(capture.stoppedAt >= capture.triggerAt);
      assert.equal(Object.hasOwn(capture.end, 'payload'), false);
    });
    if (failAction) await assert.rejects(work, /actual UI failure/); else await work;
    assert.equal(saved, true);
    assert.equal(native.events.at(-1)[0], 'mobile: stopXCTestScreenRecording');
  }
});
test('XCTest 拒绝借用已有录像、错轮次、空数据和错误采集帧率', async () => {
  let actions = 0, saves = 0;
  for (const overrides of [
    { 'mobile: getXCTestScreenRecordingInfo': metadata },
    { 'mobile: startXCTestScreenRecording': { ...metadata, fps: 24 } },
    { 'mobile: stopXCTestScreenRecording': { ...metadata, uuid: 'other', payload: movie.toString('base64') } },
    { 'mobile: stopXCTestScreenRecording': { ...metadata, payload: '' } },
    { 'mobile: stopXCTestScreenRecording': { ...metadata, payload: Buffer.from('invalid-movie').toString('base64') } },
  ]) {
    await assert.rejects(captureXCTestRecording(device(overrides), () => { actions++; }, 0,
      async () => { saves++; }));
  }
  assert.equal(actions, 3);
  // A rejected start metadata response is still stopped and preserved for diagnosis.
  assert.equal(saves, 1);
});


test('30fps采集配置在动作前确认，保留原始视频且不接受错误的实际帧率', async () => {
  const meta = { ...metadata, fps: 30 };
  const native = device({ 'mobile: startXCTestScreenRecording': meta,
    'mobile: stopXCTestScreenRecording': { ...meta, payload: movie.toString('base64') } });
  let actions = 0, saves = 0;
  await captureXCTestRecording(native, () => {
    actions++; assert.deepEqual(native.events.at(-1)[1], { fps: 30 });
  }, 0, async capture => { saves++; assert.deepEqual(capture.bytes, movie); }, 30);
  assert.equal(actions, 1); assert.equal(saves, 1);
  await assert.rejects(captureXCTestRecording(device(), () => { actions++; }, 0,
    async () => {}, 30), /30 fps/);
  assert.equal(actions, 1);
});
