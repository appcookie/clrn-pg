import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordThemeEntrance } from './game-pregame.ts';

const node = (res, text = '') => ({ res, text, enabled: true, visible: true,
  bounds: { x: 10, y: 100, width: 20, height: 20 } });
const theme = node('drawer-menu-item-theme');
const drawerExit = node('drawer-menu-item-exit');
const panel = node('game-settings-card-theme-simple');
const connecting = node('connection', 'Connecting...');

for (const missedFirstTap of [false, true]) {
  test(`主题入场${missedFirstTap ? '未生效时重新录制一次' : '成功时不重复点击'}`, async () => {
    let recordings = 0, reads = 0;
    const device = {
      screenSize: { width: 1178, height: 2556 },
      nodes: async () => {
        reads++;
        if (missedFirstTap && recordings === 1) {
          // 点击后的重连不能作为侧栏已退出的证据。
          return reads <= 2 ? [connecting] : [theme, drawerExit];
        }
        return [panel];
      },
    };
    await recordThemeEntrance(device, async () => {
      if (recordings) assert.ok(reads >= 4, '重录前必须确认连接正常且真实侧栏仍在');
      recordings++;
    });
    assert.equal(recordings, missedFirstTap ? 2 : 1);
  });
}

test('主题录制或连接失败时不重新录制', async () => {
  for (const recordingFailed of [true, false]) {
    let recordings = 0;
    const device = {
      screenSize: { width: 1178, height: 2556 },
      nodes: async () => [theme, drawerExit, node('alert', 'Connection Timeout')],
    };
    await assert.rejects(recordThemeEntrance(device, async () => {
      recordings++;
      if (recordingFailed) throw new Error('recorder failed');
    }), recordingFailed ? /recorder failed/ : /Connection Timeout/);
    assert.equal(recordings, 1);
  }
});

