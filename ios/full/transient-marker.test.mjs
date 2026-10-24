// 验证短提示及即时输入查询保留真实属性、像素坐标与驱动错误。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { NativeDevice } from './native-device.ts';
function device(overrides = {}) {
  const driver = { path: p => p, request: async (method, path, body) => {
    if (path === '/elements') {
      assert.deepEqual(body, { using: 'accessibility id', value: 'toastText1' });
      return overrides.elements ?? [{ 'element-6066-11e4-a52e-4f735466cecf': 'toast-id' }];
    }
    if (overrides.error) throw overrides.error;
    if (path.endsWith('/displayed')) return overrides.displayed ?? true;
    if (path.endsWith('/rect')) return { x: 10, y: 20, width: 100, height: 30 };
    if (path.endsWith('/attribute/label')) return 'Statistic explanation';
    throw new Error('Unexpected full-tree request');
  } };
  const d = new NativeDevice(driver, 'unused', async () => {}, async () => {}, 'app');
  d.scale = { x: 3, y: 3 };
  return d;
}
test('短提示只查询目标原生控件，验证可见性并转换截图坐标', async () => {
  assert.deepEqual(await device().transientMarker('toastText1'), { res: 'toastText1', text: 'Statistic explanation',
    bounds: { x: 30, y: 60, width: 300, height: 90 } });
});
test('提示消失或不显示不能采图，非元素缺失的驱动错误必须抛出', async () => {
  for (const opts of [{ elements: [] }, { displayed: false }, { error: { code: 'stale element reference' } }])
    assert.equal(await device(opts).transientMarker('toastText1'), null);
  const error = new Error('Transport failed');
  await assert.rejects(device({ error }).transientMarker('toastText1'), e => e === error);
  await assert.rejects(device({ elements: [{}, {}] }).transientMarker('toastText1'), /不唯一/);
});

test('短提示预先配置后一次原生查询同时返回可见性、文字和截图坐标', async () => {
  const calls = [];
  let element = { 'element-6066-11e4-a52e-4f735466cecf': 'toast-id', displayed: true,
    rect: { x: 10, y: 20, width: 100, height: 30 }, label: 'Statistic explanation' };
  const d = new NativeDevice({ path: p => p, request: async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === '/appium/settings') return;
    assert.equal(path, '/elements', '不能再发三个分离的属性查询');
    return [element];
  } }, 'unused', async () => {}, async () => {}, 'app');
  d.scale = { x: 3, y: 3 };
  await d.prepareTransientCapture();
  await d.prepareTransientCapture();
  assert.deepEqual(calls[0], { method: 'POST', path: '/appium/settings', body: { settings: {
    shouldUseCompactResponses: false, elementResponseAttributes: 'name,label,rect,displayed,enabled', screenshotQuality: 0,
  } } });
  assert.deepEqual(await d.transientMarker('toastText1'), { res: 'toastText1', text: 'Statistic explanation',
    bounds: { x: 30, y: 60, width: 300, height: 90 } });
  assert.equal(calls.length, 2);
  element = { ...element, displayed: false };
  assert.equal(await d.transientMarker('toastText1'), null);
  element = { ...element, displayed: true, rect: undefined };
  await assert.rejects(d.transientMarker('toastText1'), /缺少真实可见性或位置/);
});

test('即时输入定位先按名称查询，再检查返回元素的 displayed', async () => {
  let predicate;
  const d = new NativeDevice({ path: p => p, request: async (_method, path, body) => {
    if (path === '/appium/settings') return;
    assert.equal(path, '/elements');
    predicate = body.value;
    return [
      { name: 'drawer-menu-item-exit', label: 'Exit', displayed: false, enabled: true,
        rect: { x: 10, y: 20, width: 100, height: 30 } },
      { name: 'game-settings-card-theme-simple', label: 'Simple', displayed: true, enabled: true,
        rect: { x: 20, y: 30, width: 100, height: 30 } },
    ];
  } }, 'unused', async () => {}, async () => {}, 'app');
  d.scale = { x: 3, y: 3 };
  await d.prepareTransientCapture();
  assert.deepEqual((await d.inputObservation(['drawer-menu-item-exit', 'game-settings-card-theme-simple']))
    .map(item => item.res), ['game-settings-card-theme-simple']);
  assert.match(predicate, /name == "drawer-menu-item-exit"/);
  assert.doesNotMatch(predicate, /visible/);
});

test('短提示复用元素身份但重新读取三项真实属性，失效或隐藏后清空身份', async () => {
  let lookups = 0, label = 'initial', x = 10, displayed = true, failure;
  const attributes = [];
  const d = new NativeDevice({ path: p => p, request: async (method, path) => {
    if (path === '/appium/settings') return;
    if (path === '/elements') {
      lookups++;
      return [{ 'element-6066-11e4-a52e-4f735466cecf': `id-${lookups}`, label,
        displayed, rect: { x, y: 20, width: 100, height: 30 } }];
    }
    assert.equal(method, 'GET'); attributes.push(path);
    if (failure) throw failure;
    if (path.endsWith('/displayed')) return displayed;
    if (path.endsWith('/rect')) return { x, y: 20, width: 100, height: 30 };
    if (path.endsWith('/attribute/label')) return label;
    throw new Error('unexpected request');
  } }, 'unused', async () => {}, async () => {}, 'app');
  await d.prepareTransientCapture();
  const observe = d.transientMarkerReader('toastText1');
  assert.equal((await observe()).text, 'initial');
  label = 'changed'; x = 40;
  const next = await observe();
  assert.equal(next.text, 'changed'); assert.equal(next.bounds.x, 40);
  assert.equal(lookups, 1);
  assert.deepEqual(attributes.sort(), ['/element/id-1/attribute/label', '/element/id-1/displayed', '/element/id-1/rect']);
  failure = Object.assign(new Error('stale'), { code: 'stale element reference' });
  assert.equal(await observe(), null);
  failure = undefined;
  assert.equal((await observe()).text, 'changed'); assert.equal(lookups, 2);
  displayed = false;
  assert.equal(await observe(), null);
  displayed = true;
  await observe(); assert.equal(lookups, 3);
  failure = new Error('transport failed');
  await assert.rejects(observe(), error => error === failure);
});

test('短提示点击及采样期间关闭驱动冷却，成功和失败都恢复实际原设置', async () => {
  for (const fails of [false, true]) {
    let coolOff = 3.5, calls = 0;
    const failure = new Error('native sampling failed');
    const d = new NativeDevice({ path: p => p, request: async (method, path, body) => {
      assert.equal(path, '/appium/settings');
      if (method === 'GET') return { animationCoolOffTimeout: coolOff };
      coolOff = body.settings.animationCoolOffTimeout;
    } }, 'unused', async () => {}, async () => {}, 'app');
    const result = d.withImmediateAnimationInput(async () => {
      calls++;
      assert.equal(coolOff, 0);
      if (fails) throw failure;
      return 'captured';
    });
    if (fails) await assert.rejects(result, e => e === failure);
    else assert.equal(await result, 'captured');
    assert.equal(calls, 1, '只触发一次真实动作及采样');
    assert.equal(coolOff, 3.5, '恢复读取到的设置，不能假定默认值');
  }
});

test('新会话没有登记WDA默认值时先显式初始化，重建会话也重新配置', async () => {
  let settings = {}, writes = [];
  const d = new NativeDevice({ path: p => p,
    screenshot: async () => PNG.sync.write(new PNG({ width: 30, height: 60 })),
    request: async (method, path, body) => {
      if (path === '/window/rect') return { width: 10, height: 20 };
      assert.equal(path, '/appium/settings');
      if (method === 'GET') return { ...settings };
      writes.push(body.settings);
      settings = { ...settings, ...body.settings };
    },
  }, 'unused', async () => {}, async () => { settings = {}; }, 'app');
  await d.initialize();
  assert.deepEqual(d.screenSize, { width: 30, height: 60 });
  assert.equal(settings.animationCoolOffTimeout, 2);
  await d.prepareTransientCapture();
  await d.withImmediateAnimationInput(async () => assert.equal(settings.animationCoolOffTimeout, 0));
  assert.equal(settings.animationCoolOffTimeout, 2);
  await d.reset();
  assert.equal(settings.animationCoolOffTimeout, 2);
  await d.prepareTransientCapture();
  assert.equal(writes.filter(value => value.shouldUseCompactResponses === false).length, 2,
    '重建后的真实驱动设置已经清空，必须再次配置完整元素属性');
});

test('驱动未确认初始化设置或读取非法冷却值时不能触发动作', async () => {
  for (const value of [undefined, null, -1, '2', NaN]) {
    let calls = 0;
    const d = new NativeDevice({ path: p => p, request: async () => ({ animationCoolOffTimeout: value }) },
      'unused', async () => {}, async () => {}, 'app');
    await assert.rejects(d.initialize(), /未确认动画冷却设置/);
    await assert.rejects(d.withImmediateAnimationInput(async () => { calls++; }), /无法读取真实动画冷却设置/);
    assert.equal(calls, 0);
  }
});
