import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForHallAfterLaunchHold } from './launch-recovery.ts';

const health503 = 'ServerType: staging\nMessage: 67 v1/status\n503 server_down\nRequest failed with status code 503';
const healthTimeout = 'ServerType: staging\nMessage: 64 v1/status\n5004 request_timeout\ntimeout 5000ms exceeded';
function deviceFor(alert, buttons = ['取消', '重试'], persistent = false) {
  const commands = [];
  return {
    commands,
    alertText: async () => alert,
    nodes: async () => [{ res: 'settings-tab' }],
    execute: async (script, args) => {
      assert.equal(script, 'mobile: alert');
      commands.push(args);
      if (args.action === 'getButtons') return buttons;
      if (!persistent) alert = null;
    },
  };
}

test('释放后正常进大厅，不操作任何原生弹窗', async () => {
  const device = deviceFor(null);
  assert.deepEqual(await waitForHallAfterLaunchHold(device), { retried: false });
  assert.deepEqual(device.commands, []);
});

test('仅明确staging健康503/5004错误按原生Retry标签重试一次，然后必须进大厅', async () => {
  for (const [alert, button] of [[health503, '重试'], [health503, '重試'], [healthTimeout, 'Retry']]) {
    const device = deviceFor(alert, ['Cancel', button]);
    assert.deepEqual(await waitForHallAfterLaunchHold(device), { retried: true });
    assert.deepEqual(device.commands, [{ action: 'getButtons' }, { action: 'accept', buttonLabel: button }]);
  }
});

test('未知弹窗、其他API、生产环境或其他错误码都不能被跳过', async () => {
  for (const alert of ['Allow notifications?', health503.replace('v1/status', 'v1/login'),
    health503.replace('staging', 'production'), health503.replace('503 server_down', '401 unauthorized')]) {
    const device = deviceFor(alert);
    await assert.rejects(waitForHallAfterLaunchHold(device), /非预期原生弹窗/);
    assert.deepEqual(device.commands, []);
  }
});

test('重试失败不会再次点击；重试后没有大厅也不能通过', async () => {
  const device = deviceFor(health503, ['重试'], true);
  await assert.rejects(waitForHallAfterLaunchHold(device), /重试后再次失败/);
  assert.equal(device.commands.filter(command => command.action === 'accept').length, 1);
  const missingHall = deviceFor(health503);
  missingHall.nodes = async () => [];
  await assert.rejects(waitForHallAfterLaunchHold(missingHall, 0), /未进入大厅/);
});

test('没有唯一明确重试标签时不采用默认accept', async () => {
  for (const buttons of [['OK', 'Cancel'], ['Retry', '重试']]) {
    const device = deviceFor(health503, buttons);
    await assert.rejects(waitForHallAfterLaunchHold(device), /唯一的原生重试按钮/);
    assert.deepEqual(device.commands, [{ action: 'getButtons' }]);
  }
});
