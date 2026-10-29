import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDevice } from './native-device.ts';
import { tapRecordedLeaderboard, withRecordedLeaderboardEvidence,
  zhajinhuaLeaderboardButton as resource } from './leaderboard-entrance.ts';

const target = { res: resource, visible: true, enabled: true,
  bounds: { x: 10, y: 20, width: 30, height: 40 } };
const connecting = { ...target, res: 'connection', text: 'Connecting...' };
const timeout = { ...connecting, text: 'Connection Timeout' };
function fixture(snapshots, tapError) {
  const taps = [], attachments = new Map();
  let reads = 0, fullReads = 0;
  const device = {
    screenSize: { width: 120, height: 180 },
    prepareTransientCapture: async () => {},
    inputObservation: async () => {
      assert.equal(taps.length, 0, '点击后不能查询打断录屏');
      const nodes = snapshots[Math.min(reads++, snapshots.length - 1)];
      if (nodes instanceof Error) throw nodes;
      return nodes;
    },
    nodes: async () => { fullReads++; return []; },
    input: { tap: async point => {
      taps.push({ point, reads, at: Date.now() });
      if (tapError) throw tapError;
    } },
  };
  const info = { attach: async (name, { body }) => attachments.set(name, JSON.parse(body)) };
  return { device, info, taps, attachments, fullReads: () => fullReads,
    input: () => attachments.get('zhajinhua-leaderboard-enter-input') };
}

test('排行榜稳定入口两份当前观测后只点击一次，回执不代表应用成功', async () => {
  const f = fixture([[{ ...target, text: '私密昵称', children: [timeout] }]]);
  await tapRecordedLeaderboard(f.device, f.info);
  assert.equal(f.taps.length, 1);
  assert.equal(f.taps[0].reads, 2);
  assert.deepEqual(f.taps[0].point, { x: 25, y: 40 });
  const evidence = f.input();
  assert.equal(evidence.driverReceipt, 'returned');
  assert.equal(evidence.applicationProcessing, 'unobserved');
  assert.ok(Date.parse(evidence.tapRequestedUtc) <= f.taps[0].at);
  assert.ok(Date.parse(evidence.driverReturnedUtc) >= f.taps[0].at);
  assert.equal(evidence.observations.length, 2);
  assert.deepEqual(evidence.observations.at(-1).targets[0], {
    resource, visible: true, enabled: true, bounds: target.bounds,
  });
  assert.equal(JSON.stringify(evidence).includes('私密昵称'), false);
  assert.equal(JSON.stringify(evidence).includes('children'), false);
});

test('排行榜预热后重连必须恢复并重新确认稳定位置，不能在遮罩上点击', async () => {
  const moved = { ...target, bounds: { ...target.bounds, x: 50 } };
  const f = fixture([[target], [target, connecting], [moved]]);
  await tapRecordedLeaderboard(f.device, f.info);
  assert.equal(f.taps.length, 1);
  assert.deepEqual(f.taps[0].point, { x: 65, y: 40 });
  const evidence = f.input();
  assert.ok(evidence.observations.some(sample => sample.connection.connecting));
  const last = evidence.observations.slice(-2);
  assert.ok(last.every(sample => !sample.connection.connecting));
  assert.deepEqual(last[0].targets, last[1].targets);
  assert.ok(Date.parse(evidence.tapRequestedUtc) - Date.parse(evidence.preparationStartedUtc) >= 1390);
});

test('排行榜禁用或隐藏目标不能贡献稳定样本，恢复可用后仅点击一次', async () => {
  for (const first of [{ ...target, enabled: false }, { ...target, visible: false }]) {
    const f = fixture([[first], [target]]);
    await tapRecordedLeaderboard(f.device, f.info);
    assert.equal(f.taps.length, 1);
    assert.equal(f.taps[0].reads, 3);
  }
});

test('排行榜任一样本连接超时、重复目标或查询错误都不得点击，保留未发出回执', async () => {
  for (const bad of [[target, timeout], [timeout], [target, target], new Error('私密驱动错误')]) {
    for (const second of [false, true]) {
      const f = fixture(second ? [[target], bad] : [bad]);
      await assert.rejects(tapRecordedLeaderboard(f.device, f.info),
        /Connection Timeout|唯一可见目标|私密驱动错误/);
      assert.equal(f.taps.length, 0);
      assert.equal(f.input().driverReceipt, 'not-requested');
      assert.equal(f.input().tapRequestedUtc, undefined);
      assert.equal(f.input().driverReturnedUtc, undefined);
      assert.equal(JSON.stringify(f.input()).includes('私密驱动错误'), false);
      if (Array.isArray(bad) && bad.includes(timeout))
        assert.equal(f.input().observations.at(-1).connection.timeoutVisible, true);
    }
  }
});

test('排行榜越过屏幕的落点禁止发出输入；实际驱动错误不重试或冒充成功', async () => {
  const offscreen = fixture([[{ ...target, bounds: { ...target.bounds, x: 150 } }]]);
  await assert.rejects(tapRecordedLeaderboard(offscreen.device, offscreen.info), /真实屏幕内/);
  assert.equal(offscreen.taps.length, 0);
  assert.equal(offscreen.input().driverReceipt, 'not-requested');
  const failure = new Error('点击传输失败');
  const f = fixture([[target]], failure);
  await assert.rejects(tapRecordedLeaderboard(f.device, f.info), error => error === failure);
  assert.equal(f.taps.length, 1);
  assert.equal(f.input().driverReceipt, 'driver-error');
  assert.ok(f.input().tapRequestedUtc);
  assert.ok(f.input().driverFailedUtc);
  assert.equal(f.input().driverReturnedUtc, undefined);
});

test('真实NativeDevice观测缺少属性时不能输入；定向漏报可回查当前完整树', async () => {
  for (const malformed of [false, true]) {
    let reads = 0;
    const taps = [], attachments = new Map();
    const device = new NativeDevice({ path: p => p, source: async () => {
      reads++;
      return `<XCUIElementTypeButton name="${resource}" visible="true" enabled="true" x="50" y="20" width="30" height="40"/>`;
    }, request: async (_method, path, body) => {
      if (path === '/appium/settings') return;
      if (path === '/elements') {
        assert.ok(body.value.includes(resource));
        return malformed ? [{ name: resource, displayed: true,
          rect: { x: 50, y: 20, width: 30, height: 40 } }] : [];
      }
      assert.equal(body.script, 'mobile: tap');
      taps.push(body.args[0]);
    } }, 'unused', async () => {}, async () => {}, 'app');
    device.screenSize = { width: 120, height: 180 };
    const info = { attach: async (name, { body }) => attachments.set(name, JSON.parse(body)) };
    if (malformed) {
      await assert.rejects(tapRecordedLeaderboard(device, info), /缺少真实/);
      assert.equal(taps.length, 0);
    } else {
      await tapRecordedLeaderboard(device, info);
      assert.equal(reads, 2);
      assert.deepEqual(taps, [{ x: 65, y: 40 }]);
    }
  }
});

test('录后原有可见性断言成功或失败都先于清理保存面板语义，绝不补点', async () => {
  for (const failed of [false, true]) {
    const f = fixture([]);
    const error = new Error('public-leader-board-empty 应可见');
    let asserted = false;
    f.device.inputObservation = async markers => {
      assert.equal(asserted, true);
      assert.deepEqual(markers, ['public-leader-board-container', 'public-leader-board-empty',
        'public-leader-board-loading']);
      return failed ? [connecting] : [{ ...target, res: 'public-leader-board-empty', text: '私密文字' }];
    };
    const result = withRecordedLeaderboardEvidence(f.device, f.info, async () => {
      asserted = true;
      if (failed) throw error;
    });
    if (failed) await assert.rejects(result, actual => actual === error);
    else await result;
    const evidence = f.attachments.get('zhajinhua-leaderboard-enter-semantics');
    assert.equal(evidence.assertionsPassed, !failed);
    assert.equal(evidence.observation.connection.connecting, failed);
    assert.equal(JSON.stringify(evidence).includes('私密文字'), false);
    assert.equal(f.taps.length, 0);
  }
});

test('录后诊断驱动错误保留原断言失败；断言成功时也不能吞掉诊断错误', async () => {
  for (const failed of [false, true]) {
    const f = fixture([]);
    const assertion = new Error('缺少面板'), driver = new Error('诊断查询失败');
    f.device.inputObservation = async () => { throw driver; };
    await assert.rejects(withRecordedLeaderboardEvidence(f.device, f.info, async () => {
      if (failed) throw assertion;
    }), actual => actual === (failed ? assertion : driver));
    assert.equal(f.attachments.get('zhajinhua-leaderboard-enter-semantics').observationFailed, true);
    assert.equal(f.taps.length, 0);
  }
});
