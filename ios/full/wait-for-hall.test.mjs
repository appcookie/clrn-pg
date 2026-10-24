import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForHall } from './device.ts';

function stagingDevice(openAfterTap) {
  const events = [];
  let taps = 0;
  let keyboard = true;
  const dialog = [
    { res: 'staging-dialog-wrapper', enabled: true },
    { res: 'staging-confirmation-input', enabled: true },
    { res: 'confirm-button', enabled: true },
  ];
  const nodes = async () => taps >= openAfterTap ? [{ res: 'settings-tab', enabled: true }]
    : [...dialog, ...(keyboard ? [{ clazz: 'XCUIElementTypeKeyboard' }] : [])];
  const device = {
    nodes,
    wait: async selector => {
      assert.ok((await nodes()).some(node => node.res === selector.res), `${selector.res} must really appear`);
    },
    fill: async () => { events.push('fill'); keyboard = true; },
    hideKeyboard: async () => { events.push('hide-keyboard'); keyboard = false; },
    tap: async () => { events.push('tap'); taps++; if (taps < openAfterTap) keyboard = true; },
  };
  return { device, events };
}

test('测试版确认首次成功只点击一次', async () => {
  const { device, events } = stagingDevice(1);
  await waitForHall(device);
  assert.deepEqual(events, ['fill', 'hide-keyboard', 'tap']);
});

test('测试版弹窗与键盘仍在时再次收键盘，确认后必须到真实大厅', async () => {
  const { device, events } = stagingDevice(2);
  await waitForHall(device);
  assert.deepEqual(events, ['fill', 'hide-keyboard', 'tap', 'hide-keyboard', 'tap']);
});
