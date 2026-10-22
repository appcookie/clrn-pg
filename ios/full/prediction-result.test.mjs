import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { captureGame } from './game-capture.ts';
import { capturePredictionResult, requirePredictionResult, triggerPredictionResult } from './prediction-result.ts';

const amount = { res: 'bet-next-hand-result-amount', text: '+10',
  bounds: { x: 35, y: 45, width: 30, height: 15 } };

for (const locale of ['en', 'zh-Hans', 'zh-Hant']) test(`${locale} 猜牌完成背景准备后委托同次截图，不查询过期AX`, async () => {
  const events = [], attachments = new Map();
  const name = `${locale}-signed-in-texas-hall-prediction-result`;
  await captureGame({ screenSize: { width: 100, height: 100 },
    nodes: async () => { events.push('tree'); return []; },
    transientMarker: async () => { throw new Error('短时结果不应再查询AX'); } }, name,
  { attach: async (key, value) => { attachments.set(key, value); } }, amount.res, undefined, [],
  async () => { events.push('trigger'); return '+10'; },
  async (_device, actualName, _info, _masks, trigger) => {
    assert.equal(actualName, name);
    assert.ok(attachments.has(`${name}-native-tree`));
    assert.equal(await trigger(), '+10');
  });
  assert.deepEqual(events, ['tree', 'trigger']);
});

test('真实时间递增的三张截图须同时显示中奖文案和 +10，且仅发送一次', async () => {
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const frame = visible => {
    const image = new PNG({ width: 100, height: 100 }); image.data.fill(255);
    if (visible) for (let y = 40; y < 62; y++) for (let x = 20; x < 80; x++) {
      const p = (y * 100 + x) * 4; image.data[p] = 6; image.data[p + 1] = 26; image.data[p + 2] = 35;
    }
    return PNG.sync.write(image);
  };
  const hidden = frame(false), shown = frame(true);
  const frames = Object.assign([hidden, shown, shown, shown, hidden],
    { timestampsMs: [0, 100, 250, 400, 500], sourceFrameIndices: [0, 1, 2, 3, 4] });
  const title = { text: 'Congratulations on winning the guessing hand reward.', confidence: 0.95,
    bounds: { x: 0.25, y: 0.44, width: 0.5, height: 0.04 } };
  const win = { text: '+10', confidence: 0.95, bounds: { x: 0.44, y: 0.52, width: 0.12, height: 0.04 } };
  const recognized = [[], [title, win], [title, win], [title, win], []];
  const attachments = new Map(), info = { attach: async (name, value) => attachments.set(name, value) };
  let triggered = 0;
  const run = (observations = recognized, samples = frames) => capturePredictionResult(
    { screenSize: { width: 100, height: 100 } }, 'en-signed-in-texas-hall-prediction-result', info, [],
    async () => { triggered++; return '+10'; },
    async (_device, _name, _info, action) => ({ frames: samples, result: await action() }),
    async () => observations);
  try {
    await run();
    assert.equal(triggered, 1);
    assert.ok(attachments.has('en-signed-in-texas-hall-prediction-result.png'));
    assert.deepEqual(JSON.parse(attachments.get('en-signed-in-texas-hall-prediction-result-screenshot-keyframes').body)
      .map(item => item.frameIndex), [1, 2, 3]);
    await assert.rejects(run([[], [title, { ...win, text: '+100' }], [title, win], [title, win], []]),
      /同次原生截图序列必须拍到/);
    await assert.rejects(run([[], [title, { ...win, bounds: { ...win.bounds, y: 0.62 } }],
      [title, win], [title, win], []]), /同次原生截图序列必须拍到/);
    await assert.rejects(run([[], [title, win], [title, win], [title, win], [title, win]]), /截图序列结束前消失/);
    await assert.rejects(run(recognized, Object.assign([...frames],
      { timestampsMs: [0, 100, 150, 200, 500], sourceFrameIndices: frames.sourceFrameIndices })), /250 毫秒/);
    assert.equal(triggered, 5, '失败诊断也不能在同次运行内重放事件');
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});

test('结果缺失、错误金额、被遮罩或查询出错不能被当成有效截图', async () => {
  for (const node of [null, { ...amount, text: '-10' }, { ...amount, text: '+20' }]) {
    await assert.rejects(requirePredictionResult({ transientMarker: async () => node }, []), /准确为 \+10/);
  }
  await assert.rejects(requirePredictionResult({ transientMarker: async () => amount },
    [{ ...amount.bounds, reason: '错误遮罩' }]), /不能被背景动态遮罩覆盖/);
  const failure = new Error('native transport failed');
  await assert.rejects(requirePredictionResult({ transientMarker: async () => { throw failure; } }, []),
    error => error === failure);
});

test('准备后触发的猜牌通道不能用于其他页面或其他短时状态', async () => {
  for (const [name, marker] of [
    ['en-signed-in-texas-hall-prediction-loss', amount.res],
    ['en-signed-in-texas-hall-prediction-result', 'level-up-title'],
  ]) {
    await assert.rejects(captureGame({}, name, {}, marker, undefined, [], async () => '+10'), /提前准备遮罩仅用于/);
  }
});

test('猜牌事件只发到当前真实房间；发送失败不重发', async () => {
  const failure = new Error('acknowledgement failed');
  const run = async (registeredRoom, fail) => {
    const calls = [];
    const result = triggerPredictionResult({ room: 'this-room', proxy: { command: async (path, body) => {
      calls.push({ path, body });
      if (path === 'android/session') return { room: registeredRoom ? { roomId: registeredRoom } : null };
      assert.equal(path, 'texas/replay');
      assert.equal(body.roomId, 'this-room');
      assert.equal(body.data.stream, 'texas_holdem');
      assert.deepEqual(body.data.queue,
        [{ event: 'settlement_hand_prediction', result: { net: 10, currency_name: 'coin' } }]);
      if (fail) throw failure;
      return {};
    } } });
    if (registeredRoom !== 'this-room') {
      await assert.rejects(result, /本轮新建的私人房/);
      assert.deepEqual(calls.map(call => call.path), ['android/session']);
    } else {
      if (fail) await assert.rejects(result, error => error === failure);
      else assert.equal(await result, '+10');
      assert.deepEqual(calls.map(call => call.path), ['android/session', 'texas/replay']);
    }
  };
  await run('this-room', false);
  await run('this-room', true);
  await run('another-room', false);
  await run(null, false);
});
