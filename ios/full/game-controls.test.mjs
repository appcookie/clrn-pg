// 验证真实驱动契约下的稳定点击、即时连接观测及失败传播，禁止重试业务动作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDevice } from './native-device.ts';
import { gameTap, gameTapCurrent, gameConnected, gameConnectedCurrent, gameGoneCurrent, gameConnectionState,
  gameReady, gameReadyCurrent, gameGone } from './game-controls.ts';

test('录像内关闭和连接查询只读实际标记，短暂重连重置连续就绪时间', async () => {
  let panelQueries = 0, connectionQueries = 0, lastConnectingAt = 0;
  const node = label => ({ name: label, label, displayed: true, enabled: true,
    rect: { x: 10, y: 10, width: 40, height: 20 } });
  const device = new NativeDevice({ path: p => p, source: async () => {
    throw new Error('录像就绪不能读取整树');
  }, request: async (_method, path, body) => {
    if (path === '/appium/settings') return;
    assert.equal(path, '/elements');
    assert.equal(body.using, '-ios predicate string');
    if (body.value.includes('review-board-description-text')) {
      panelQueries++;
      return panelQueries === 1 ? [node('review-board-description-text')] : [];
    }
    assert.ok(!body.value.includes('name =='), '连接查询不匹配任何无关控件');
    connectionQueries++;
    if (connectionQueries === 3) {
      lastConnectingAt = Date.now();
      return [node('Connecting...')];
    }
    return [];
  } }, 'unused', async () => {}, async () => {}, 'app');
  await gameGoneCurrent(device, 'review-board-description-text');
  assert.equal(panelQueries, 2);
  await gameConnectedCurrent(device, 1_000);
  assert.ok(connectionQueries >= 4, '重连后仍须重新观测连接状态');
  assert.ok(Date.now() - lastConnectingAt >= 1_000);
});

test('录像就绪查询的真实连接超时不能当成面板消失或恢复', async () => {
  const device = new NativeDevice({ path: p => p, request: async (_method, path) => {
    if (path === '/appium/settings') return;
    return [{ name: 'alert', label: 'Connection Timeout', displayed: true, enabled: true,
      rect: { x: 10, y: 10, width: 40, height: 20 } }];
  } }, 'unused', async () => {}, async () => {}, 'app');
  await assert.rejects(gameGoneCurrent(device, 'review-board-description-text'), /Connection Timeout/);
  await assert.rejects(gameConnectedCurrent(device, 1_000), /Connection Timeout/);
});

test('重连遮罩下的暂时缺失不能视为侧栏关闭，恢复后仍须观察真实消失', async () => {
  let queries = 0;
  const panel = { name: 'review-board-description-text', label: 'Empty games', displayed: true,
    enabled: true, rect: { x: 10, y: 10, width: 40, height: 20 } };
  const snapshots = [[{ ...panel, name: 'connection', label: 'Connecting...' }], [panel], []];
  const device = new NativeDevice({ path: p => p, request: async (_method, path) => {
    if (path === '/appium/settings') return;
    return snapshots[queries++];
  } }, 'unused', async () => {}, async () => {}, 'app');
  await gameGoneCurrent(device, 'review-board-description-text');
  assert.equal(queries, 3, '不能在连接遮罩隐藏侧栏时提前返回');
});

test('遮罩边缘点击使用两次最新稳定边界，越界落点禁止触发动作', async () => {
  for (const invalid of [false, true]) {
    let queries = 0;
    const taps = [];
    const device = new NativeDevice({ path: p => p, request: async (_method, path, body) => {
      if (path === '/appium/settings') return;
      if (path === '/elements') {
        queries++;
        return [{ name: 'screen-mask-touch-to-close', label: '', displayed: true, enabled: true,
          rect: { x: queries === 1 ? 10 : 20, y: 10, width: 60, height: 180 } }];
      }
      assert.equal(body.script, 'mobile: tap');
      taps.push(body.args[0]);
    } }, 'unused', async () => {}, async () => {}, 'app');
    const click = gameTapCurrent(device, 'screen-mask-touch-to-close', bounds => ({
      x: bounds.x + (invalid ? bounds.width : 3), y: bounds.y + 50,
    }));
    if (invalid) await assert.rejects(click, /当前真实目标内/);
    else await click;
    assert.equal(queries, 3);
    assert.deepEqual(taps, invalid ? [] : [{ x: 23, y: 60 }]);
  }
});

test('即时入口在同次元素查询中检查目标与重连，连接恢复后只点击一次', async () => {
  for (const first of ['healthy', 'connecting', 'timeout', 'disabled', 'malformed', 'transport']) {
    const target = { name: 'game-record-button', label: '', displayed: true, enabled: true,
      rect: { x: 10.2, y: 20.2, width: 30.2, height: 40.2 } };
    let queries = 0, taps = 0;
    const points = [];
    const device = new NativeDevice({ path: p => p, source: async () => {
      throw new Error('即时观测不能读取耗时整树');
    }, request: async (_method, path, body) => {
      if (path === '/appium/settings') return;
      if (path === '/elements') {
        queries++;
        assert.equal(body.using, '-ios predicate string');
        assert.match(body.value, /name == "game-record-button"/);
        assert.match(body.value, /Connecting/);
        assert.match(body.value, /Connection Timeout/);
        if (first === 'transport') throw new Error('driver transport failed');
        if (first === 'malformed') return [{ ...target, enabled: undefined }];
        if (first === 'timeout') return [target, { ...target, name: 'alert', label: 'Connection Timeout' }];
        if (queries === 2 && first === 'connecting') return [target,
          { ...target, name: 'connection', label: 'Connecting...' }];
        if (queries === 1 && first === 'disabled') return [{ ...target, enabled: false }];
        return [target];
      }
      assert.equal(path, '/execute/sync');
      assert.equal(body.script, 'mobile: tap');
      taps++; points.push(body.args[0]);
    } }, 'unused', async () => {}, async () => {}, 'app');
    device.screenSize = { width: 100, height: 200 };
    if (['timeout', 'malformed', 'transport'].includes(first)) {
      await assert.rejects(gameTapCurrent(device, 'game-record-button'),
        /Connection Timeout|缺少真实|driver transport failed/);
      assert.equal(taps, 0);
    } else {
      await gameTapCurrent(device, 'game-record-button');
      assert.equal(taps, 1);
      assert.deepEqual(points, [{ x: 26, y: 41 }]);
      assert.ok(queries >= (first === 'connecting' ? 7 : first === 'disabled' ? 3 : 2));
    }
  }
});

const button = { res: 'target', enabled: true, x: 10, y: 20, width: 30, height: 40 };
const message = text => ({ res: 'common-alert-title', text, x: 1, y: 1, width: 80, height: 10 });
function driverFixture(snapshots) {
  const reads = [], taps = [];
  const driver = { path: path => path, source: async () => {
    const index = reads.length;
    reads.push(Date.now());
    const nodes = snapshots[Math.min(index, snapshots.length - 1)];
    if (nodes instanceof Error) throw nodes;
    return '<XCUIElementTypeApplication name="app" x="0" y="0" width="100" height="200" visible="true" enabled="true">'
      + nodes.map(node => `<XCUIElementTypeOther name="${node.res}" label="${node.text || ''}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" visible="${node.visible !== false}" enabled="${node.enabled !== false}"/>`).join('')
      + '</XCUIElementTypeApplication>';
  }, request: async (method, path, body) => {
    assert.equal(method, 'POST');
    assert.equal(path, '/execute/sync');
    assert.equal(body.script, 'mobile: tap');
    taps.push({ point: body.args[0], reads: reads.length, at: Date.now() });
  } };
  const device = new NativeDevice(driver, 'unused', async () => {}, async () => {}, 'app');
  device.screenSize = { width: 100, height: 200 };
  return { device, reads, taps };
}

test('牌桌就绪及关闭等待立即报告连接超时和驱动错误，不能等到后续样本恢复后通过', async () => {
  for (const wait of [gameReady, gameGone]) {
    for (const bad of [[message('Connection Timeout')], new Error('原生驱动读取失败')]) {
      const recovered = wait === gameReady ? [button] : [];
      const { device, reads } = driverFixture([bad, recovered]);
      await assert.rejects(wait(device, 'target'), error => bad instanceof Error
        ? error === bad : /Connection Timeout/.test(error.message));
      assert.equal(reads.length, 1, '真实连接错误和驱动错误不能被等待重试吞掉');
    }
  }
});

test('牌桌定向就绪等待立即报告连接超时和驱动错误，不以恢复后的目标掩盖失败', async () => {
  for (const bad of [[message('Connection Timeout')], new Error('原生定向查询失败')]) {
    let reads = 0;
    const target = { ...button, bounds: { x: 10, y: 20, width: 30, height: 40 } };
    const device = {
      prepareTransientCapture: async () => {},
      inputObservation: async () => {
        if (reads++) return [target];
        if (bad instanceof Error) throw bad;
        return bad;
      },
      nodes: async () => { throw new Error('错误观测后不应读取完整树'); },
    };
    await assert.rejects(gameReadyCurrent(device, 'target'), error => bad instanceof Error
      ? error === bad : /Connection Timeout/.test(error.message));
    assert.equal(reads, 1, '定向等待不能在真实错误后继续轮询');
  }
});

test('重连中的目标可见不能证明就绪，面板暂时缺失也不能证明关闭', async () => {
  const ready = driverFixture([[button, message('Connecting...')], [button]]);
  assert.equal((await gameReady(ready.device, 'target')).res, 'target');
  assert.equal(ready.reads.length, 2, '必须等到连接遮罩消失才确认就绪');
  const gone = driverFixture([[message('Connecting...')], [button], []]);
  await gameGone(gone.device, 'target');
  assert.equal(gone.reads.length, 3, '必须在连接恢复后确认面板真实消失');
});

test('定向查询漏报后读取的新原生树仍须检查连接超时和重连遮罩', async () => {
  for (const timedOut of [false, true]) {
    const first = timedOut ? message('Connection Timeout') : message('Connecting...');
    const { device, reads } = driverFixture([[button, first], [button]]);
    device.prepareTransientCapture = async () => {};
    device.inputObservation = async () => [];
    if (timedOut) {
      await assert.rejects(gameReadyCurrent(device, 'target'), /Connection Timeout/);
      assert.equal(reads.length, 1, '回查出现连接超时也必须立即失败');
    } else {
      assert.equal((await gameReadyCurrent(device, 'target')).res, 'target');
      assert.equal(reads.length, 2, '不能使用回查中被重连遮罩覆盖的目标');
    }
  }
});

test('真实NativeDevice source契约：健康点击只读取两次完整树并点击一次稳定中心', async () => {
  const { device, reads, taps } = driverFixture([[button]]);
  await gameTap(device, 'target');
  assert.equal(reads.length, 2, '不再为gameConnected单独读取第三次整树');
  assert.deepEqual(taps.map(tap => tap.point), [{ x: 25, y: 40 }]);
  assert.equal(taps[0].reads, 2);
  assert.ok(reads[1] - reads[0] >= 190, '保留原200ms两样本间隔');
});

test('任一样本出现Connection Timeout或驱动错误都直接拒绝点击', async () => {
  const transport = new Error('native source transport failure');
  for (const bad of [[button, message('Connection Timeout')], transport]) {
    for (const sample of [0, 1]) {
      const snapshots = sample ? [[button], bad] : [bad];
      const { device, reads, taps } = driverFixture(snapshots);
      await assert.rejects(gameTap(device, 'target'), error => bad === transport
        ? error === transport : /Connection Timeout/.test(error.message));
      assert.equal(taps.length, 0);
      assert.equal(reads.length, sample + 1, '不能等错误消失后继续操作');
    }
  }
});

test('任一样本重复目标均拒绝；隐藏同名节点不冒充可见目标', async () => {
  for (const snapshots of [[[button, button]], [[button], [button, button]]]) {
    const { device, taps } = driverFixture(snapshots);
    await assert.rejects(gameTap(device, 'target'), /唯一可见目标/);
    assert.equal(taps.length, 0);
  }
  const { device, reads, taps } = driverFixture([[button, { ...button, visible: false }]]);
  await gameTap(device, 'target');
  assert.equal(reads.length, 2);
  assert.equal(taps.length, 1);
});

test('第一份disabled或移动中的bounds不能作为稳定点击证据', async () => {
  for (const first of [{ ...button, enabled: false }, { ...button, x: 20 }]) {
    const { device, reads, taps } = driverFixture([[first], [button], [button]]);
    await gameTap(device, 'target');
    assert.equal(reads.length, 3);
    assert.equal(taps.length, 1);
    assert.equal(taps[0].reads, 3);
  }
});

test('任一样本重连都保留一秒恢复门禁，恢复后重新取得两份稳定目标', async () => {
  for (const sample of [0, 1]) {
    const reconnecting = [button, message('Connecting...')];
    const snapshots = sample ? [[button], reconnecting, [button]] : [reconnecting, [button]];
    const { device, reads, taps } = driverFixture(snapshots);
    await gameTap(device, 'target');
    assert.equal(taps.length, 1);
    const firstClearRead = reads[sample + 1];
    assert.ok(taps[0].at - firstClearRead >= 1190, '一秒无重连后还要保留200ms独立目标样本');
    assert.ok(reads.length >= sample + 6);
  }
});

test('Connection Timeout检测单独加强，普通业务确认弹窗和隐藏旧错误不被泛禁', async () => {
  const { device, reads, taps } = driverFixture([[button, message('Authentication failed'),
    { ...message('Connection Timeout'), visible: false }]]);
  await gameTap(device, 'target');
  assert.equal(reads.length, 2);
  assert.equal(taps.length, 1);
  assert.throws(() => gameConnectionState([{ text: 'Connection Timeout', visible: true }]), /Connection Timeout/);
  const blocked = driverFixture([[button, message('Connection Timeout')]]);
  await assert.rejects(gameConnected(blocked.device), /Connection Timeout/);
  assert.equal(blocked.reads.length, 1);
});


test('恢复耗时超过目标稳定预算时，恢复后的两份观测仍有独立45秒预算', async t => {
  const fixture = driverFixture([[button], [button, message('Connecting...')], [button]]);
  const realNow = Date.now.bind(Date);
  // Simulate a long connection recovery without waiting a minute in a unit test.
  t.mock.method(Date, 'now', () => realNow() + (fixture.reads.length >= 3 ? 60_000 : 0));
  await gameTap(fixture.device, 'target');
  assert.equal(fixture.taps.length, 1);
  assert.ok(fixture.reads.length >= 7);
  assert.ok(fixture.taps[0].at - fixture.reads[0] >= 61_190);
});

test('短暂消失的目标必须重新取得两份真实稳定样本', async () => {
  const { device, reads, taps } = driverFixture([[button], [], [button], [button]]);
  await gameTap(device, 'target');
  assert.equal(reads.length, 4);
  assert.equal(taps.length, 1);
});


test('点击诊断仅在实际tap前调用一次，传入副本不允许改变输入坐标', async () => {
  const { device, taps } = driverFixture([[button]]);
  const notifications = [];
  await gameTap(device, 'target', false, point => {
    assert.equal(taps.length, 0);
    notifications.push({ point: { ...point }, at: Date.now() });
    point.x = 999;
  });
  assert.equal(notifications.length, 1);
  assert.deepEqual(taps[0].point, notifications[0].point);
  assert.ok(taps[0].at >= notifications[0].at);
});


test('predicate遗漏实际可见入口时读取新原生树，仍需两次稳定布局且只点击一次', async () => {
  const { device, reads, taps } = driverFixture([[button], [{ ...button, x: 20 }], [{ ...button, x: 20 }]]);
  const request = device.driver.request;
  let queries = 0;
  device.driver.request = async (method, path, body) => {
    if (path === '/appium/settings') return;
    if (path === '/elements') { queries++; return []; }
    return request(method, path, body);
  };
  await gameTapCurrent(device, 'target');
  assert.equal(queries, 3); assert.equal(reads.length, 3);
  assert.deepEqual(taps.map(tap => tap.point), [{ x: 35, y: 40 }]);
});

test('完整树回查的连接超时和驱动错误不能被空predicate掩盖', async () => {
  for (const snapshot of [[button, message('Connection Timeout')], new Error('source failed')]) {
    const { device, taps } = driverFixture([snapshot]);
    const request = device.driver.request;
    device.driver.request = async (method, path, body) => {
      if (path === '/appium/settings') return;
      if (path === '/elements') return [];
      return request(method, path, body);
    };
    await assert.rejects(gameTapCurrent(device, 'target'), /Connection Timeout|source failed/);
    assert.equal(taps.length, 0);
  }
});
