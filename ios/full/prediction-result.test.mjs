import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { captureGame } from './game-capture.ts';
import { requirePredictionResult, triggerPredictionResult } from './prediction-result.ts';

const amount = { res: 'bet-next-hand-result-amount', text: '+10',
  bounds: { x: 35, y: 45, width: 30, height: 15 } };

for (const locale of ['en', 'zh-Hans', 'zh-Hant']) test(`${locale} 猜牌先准备再单次触发，全部截图前后定向检查 +10`, async () => {
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    const events = [], attachments = new Map();
    let triggered = 0, queries = 0;
    const image = new PNG({ width: 100, height: 100 });
    image.data.fill(255);
    const png = PNG.sync.write(image);
    const device = {
      screenSize: { width: 100, height: 100 },
      nodes: async () => {
        assert.equal(triggered, 0, '短时结果出现后不能再进行整树准备');
        events.push('tree');
        return [];
      },
      transientMarker: async res => {
        assert.equal(triggered, 1);
        assert.equal(res, amount.res);
        queries++;
        events.push('amount');
        return amount;
      },
      marker: async () => { throw new Error('不能用整树 marker 查询短时结果'); },
      nativeScreenshot: async () => {
        assert.equal(events.at(-1), 'amount', '截图前必须验证实际金额');
        events.push('screenshot');
        await delay(100);
        return png;
      },
    };
    await captureGame(device, `${locale}-signed-in-texas-hall-prediction-result`,
      { attach: async (name, value) => { events.push(`attach:${name}`); attachments.set(name, value); } },
      amount.res, undefined, [], async () => {
        assert.equal(events[0], 'tree');
        assert.ok(attachments.has(`${locale}-signed-in-texas-hall-prediction-result-native-tree`));
        triggered++;
        events.push('trigger');
        return '+10';
      });
    assert.equal(triggered, 1);
    assert.ok(queries >= 4);
    const shots = events.flatMap((event, i) => event === 'screenshot' ? [i] : []);
    assert.ok(shots.length >= 2);
    for (const index of shots) assert.equal(events[index + 1], 'amount', '截图后必须仍有准确金额');
    assert.ok(attachments.has(`${locale}-signed-in-texas-hall-prediction-result.png`));
    const evidence = JSON.parse(attachments.get(`${locale}-signed-in-texas-hall-prediction-result-transient-observations`).body);
    assert.ok(evidence.length >= 3);
    assert.ok(evidence.every(node => node.text === '+10' && Number.isFinite(Date.parse(node.utc))));
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
