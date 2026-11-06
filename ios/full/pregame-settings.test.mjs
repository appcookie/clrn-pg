import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enablePreGameSetting } from './game-pregame.ts';

function settingDevice(marker, enableOnTap) {
  let checked = false;
  const taps = [];
  const bounds = { x: 887, y: 948, width: 157, height: 96 };
  return {
    taps,
    screenSize: { width: 1178, height: 2556 },
    nodes: async () => [{ res: marker, bounds, checked, enabled: true, visible: true }],
    input: { tap: async point => {
      taps.push(point);
      if (taps.length === enableOnTap) checked = true;
    } },
  };
}

for (const setting of ['vibrate', 'shake-avatar']) {
  test(`${setting}: CI 中未生效的点击仅在仍关闭时重试，并确认开启`, async () => {
    const marker = `game-settings-switch-${setting}`;
    const device = settingDevice(marker, 2);
    await enablePreGameSetting(device, marker);
    assert.deepEqual(device.taps, [{ x: 935, y: 996 }, { x: 966, y: 996 }]);
    assert.equal((await device.nodes())[0].checked, true);
  });
}

test('首次点击已开启时不再点击，避免把开关关闭', async () => {
  const marker = 'game-settings-switch-vibrate';
  const device = settingDevice(marker, 1);
  await enablePreGameSetting(device, marker);
  assert.equal(device.taps.length, 1);
  assert.equal((await device.nodes())[0].checked, true);
});

test('重试后仍关闭必须失败，不能以已发送点击代替状态检查', async () => {
  const marker = 'game-settings-switch-shake-avatar';
  const device = settingDevice(marker, Infinity);
  await assert.rejects(enablePreGameSetting(device, marker), /必须实际开启/);
  assert.equal(device.taps.length, 2);
});
