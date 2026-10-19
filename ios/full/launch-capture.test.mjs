import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { captureLaunchBranding, verifyLaunchCapture } from './launch-capture.ts';

test('图与树只采一轮并发执行，全部完成立即释放，离线验证不会延长hold', async () => {
  const events = [];
  const result = await captureLaunchBranding({
    nodes: async () => { events.push('nodes'); await delay(5); events.push('nodes done'); return []; },
    screenshot: async () => { events.push('screenshot'); await delay(10); events.push('screenshot done'); return Buffer.from('real'); },
    release: async () => { events.push('release'); },
  });
  assert.deepEqual(events, ['nodes', 'screenshot', 'nodes done', 'screenshot done', 'release']);
  assert.equal(result.bytes.toString(), 'real');
  assert.equal(result.releasedByBudget, false);
});

test('慢采集先有界释放但不伪造图或树；真实内容仍由离线验证决定', async () => {
  const events = [];
  const result = await captureLaunchBranding({ nodes: async () => [],
    screenshot: async () => { await delay(20); events.push('captured'); return Buffer.from('late'); },
    release: async () => { events.push('release'); },
  }, 5);
  assert.deepEqual(events, ['release', 'captured']);
  assert.equal(result.releasedByBudget, true);
  assert.equal(result.bytes.toString(), 'late');
});

test('原生采集错误仍释放hold并原样失败；释放失败也不能通过', async () => {
  for (const key of ['nodes', 'screenshot']) {
    const error = new Error('native capture failed');
    let released = 0;
    const operations = { nodes: async () => [], screenshot: async () => Buffer.alloc(0), release: async () => { released++; } };
    operations[key] = async () => { throw error; };
    await assert.rejects(captureLaunchBranding(operations), actual => actual === error);
    assert.equal(released, 1);
  }
  await assert.rejects(captureLaunchBranding({ nodes: async () => [], screenshot: async () => Buffer.alloc(0),
    release: async () => { throw new Error('release failed'); } }), /release failed/);
});

const size = { width: 128, height: 256 };
const brand = { x: 10, y: 30, width: 100, height: 25 };
const nodes = [
  { res: 'launch-screen-container', clazz: 'XCUIElementTypeOther', visible: true, bounds: { x: 0, y: 0, ...size }, children: [] },
  { res: 'launch-brand-name', clazz: 'XCUIElementTypeStaticText', visible: true, bounds: brand, children: [] },
];
function pictures() {
  const reference = new PNG({ ...size });
  for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
    const cloud = Math.sin(x / 9) * Math.cos(y / 23) * 30;
    reference.data.set([75 + x / 3 + cloud - (x < y % 83 ? 35 : 0), 115 + y / 5 + cloud, 238 + cloud / 4, 255], (y * size.width + x) * 4);
  }
  const picture = PNG.sync.read(PNG.sync.write(reference));
  for (let y = brand.y; y < brand.y + brand.height; y++) for (let x = brand.x; x < brand.x + brand.width; x++) {
    if (x % 8 < 3) picture.data.set([255, 255, 255, 255], (y * size.width + x) * 4);
  }
  return { reference, picture };
}

test('真实插画与品牌文字同时可见才能接受；空白和只有背景不能冒充品牌页', () => {
  const { reference, picture } = pictures();
  assert.ok(verifyLaunchCapture(PNG.sync.write(picture), nodes, size, reference).brandInkRatio > .03);
  assert.throws(() => verifyLaunchCapture(PNG.sync.write(reference), nodes, size, reference), /缺少真实可见/);
  picture.data.fill(255);
  assert.throws(() => verifyLaunchCapture(PNG.sync.write(picture), nodes, size, reference), /不是完整无遮挡/);
});

test('树中任何Alert或Staging提示都拒绝，即使截图看起来正确', () => {
  const { reference, picture } = pictures();
  const bytes = PNG.sync.write(picture);
  assert.throws(() => verifyLaunchCapture(bytes, [...nodes, { clazz: 'XCUIElementTypeAlert', visible: true }], size, reference), /错误弹窗/);
  assert.throws(() => verifyLaunchCapture(bytes, [...nodes, { res: 'staging-dialog', visible: true }], size, reference), /Staging提示/);
  assert.throws(() => verifyLaunchCapture(bytes, nodes.slice(1), size, reference), /没有可见/);
  assert.throws(() => verifyLaunchCapture(bytes, nodes, { ...size, width: 127 }, reference), /全屏尺寸/);
});

test('并发树未包含弹窗时，截图里的错误卡片或过渡暗层仍必须被像素检查拒绝', () => {
  const { reference, picture } = pictures();
  for (let y = 100; y < 170; y++) for (let x = 20; x < 110; x++) picture.data.set([230, 240, 250, 255], (y * size.width + x) * 4);
  assert.throws(() => verifyLaunchCapture(PNG.sync.write(picture), nodes, size, reference), /不是完整无遮挡/);
  const dimmed = pictures().picture;
  for (let i = 0; i < dimmed.data.length; i++) if (i % 4 !== 3) dimmed.data[i] *= .65;
  assert.throws(() => verifyLaunchCapture(PNG.sync.write(dimmed), nodes, size, reference), /不是完整无遮挡/);
});
