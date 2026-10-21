import test from 'node:test';
import assert from 'node:assert/strict';
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
    shouldUseCompactResponses: false, elementResponseAttributes: 'label,rect,displayed', screenshotQuality: 0,
  } } });
  assert.deepEqual(await d.transientMarker('toastText1'), { res: 'toastText1', text: 'Statistic explanation',
    bounds: { x: 30, y: 60, width: 300, height: 90 } });
  assert.equal(calls.length, 2);
  element = { ...element, displayed: false };
  assert.equal(await d.transientMarker('toastText1'), null);
  element = { ...element, displayed: true, rect: undefined };
  await assert.rejects(d.transientMarker('toastText1'), /缺少真实可见性或位置/);
});
