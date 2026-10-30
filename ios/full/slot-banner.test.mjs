import test from 'node:test';
import assert from 'node:assert/strict';
import { pressSlotBanner } from './slot-banner.ts';

function fixture(onTap = async () => {}) {
  const attachments = [];
  const taps = [];
  let observations = 0;
  const device = {
    screenSize: { width: 120, height: 180 },
    prepareTransientCapture: async () => {},
    inputObservation: async res => {
      assert.equal(res, 'slot-banner');
      return [{ res, enabled: true, visible: true,
        bounds: { x: ++observations === 1 ? 10 : 50, y: 20, width: 30, height: 40 } }];
    },
    nodes: async () => { throw new Error('已有真实目标时不得另读旧树'); },
    input: { tap: async point => { taps.push(point); await onTap(); } },
  };
  const info = { attach: async (name, attachment) => {
    assert.equal(name, 'slot-banner-tap');
    assert.equal(attachment.contentType, 'application/json');
    attachments.push(JSON.parse(attachment.body));
  } };
  return { device, info, taps, attachments, observations: () => observations };
}

test('老虎机横幅移动后必须取得两次稳定的新位置，再单次点击旋转入口', async () => {
  const value = fixture();
  await pressSlotBanner(value.device, value.info);
  assert.equal(value.observations(), 3, '移动前的位置不能作为稳定点击证据');
  assert.deepEqual(value.taps, [{ x: 72, y: 48 }], '必须使用新横幅内已审查的旋转入口');
  const timing = value.attachments[0];
  assert.equal(value.attachments.length, 1);
  assert.deepEqual({ x: timing.tap.x, y: timing.tap.y }, value.taps[0]);
  assert.ok(Date.parse(timing.preparedAt) <= Date.parse(timing.tap.requestedAt));
  assert.ok(Date.parse(timing.tap.requestedAt) <= Date.parse(timing.completedAt));
});

test('老虎机横幅观测遇到驱动故障时不点击，保留准备时序并传播原错误', async () => {
  const failure = new Error('原生观测失败');
  const value = fixture();
  value.device.inputObservation = async () => { throw failure; };
  await assert.rejects(pressSlotBanner(value.device, value.info), error => error === failure);
  assert.equal(value.taps.length, 0);
  assert.equal(value.attachments.length, 1);
  assert.equal(value.attachments[0].tap, undefined, '未发出点击不能记录成已点击');
});

test('老虎机横幅点击失败时不补点，仍记录本次落点并传播原错误', async () => {
  const failure = new Error('原生点击失败');
  const value = fixture(async () => { throw failure; });
  await assert.rejects(pressSlotBanner(value.device, value.info), error => error === failure);
  assert.equal(value.taps.length, 1);
  assert.deepEqual(value.taps[0], { x: 72, y: 48 });
  assert.equal(value.attachments[0].tap.x, 72);
});
