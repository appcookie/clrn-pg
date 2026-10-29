import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDevice } from './native-device.ts';
import { reveal, tap } from './navigation.ts';

function navigationDevice(observe = () => ({})) {
  let reads = 0;
  const events = [];
  const driver = {
    path: suffix => suffix,
    source: async () => {
      const { x = 20, viewportHeight = 500, visible = true, enabled = true } = observe(++reads);
      events.push('读取界面');
      return `<AppiumAUT><XCUIElementTypeApplication visible="true" enabled="true" x="0" y="0" width="400" height="800">
        <XCUIElementTypeScrollView visible="${visible}" enabled="true" x="0" y="0" width="400" height="${viewportHeight}">
          <XCUIElementTypeButton name="confirm-button" visible="true" enabled="${enabled}" x="${x}" y="100" width="80" height="40"/>
        </XCUIElementTypeScrollView>
      </XCUIElementTypeApplication></AppiumAUT>`;
    },
    request: async (_method, _path, body) => {
      assert.equal(body.script, 'mobile: tap', '只能在验证真实目标后执行点击');
      events.push(body.args[0]);
    },
  };
  const device = new NativeDevice(driver, 'test', async () => {}, async () => {}, 'test.app');
  device.screenSize = { width: 400, height: 800 };
  return { device, events };
}

test('控件就绪和祖先裁切共享一次原生观测，返回该次快照', async () => {
  const { device, events } = navigationDevice();
  const snapshot = await reveal(device, { res: 'confirm-button' });
  assert.equal((await device.info({ res: 'confirm-button' }, snapshot)).bounds.x, 20);
  assert.deepEqual(events, ['读取界面'], '没有界面操作时不能为同一检查重复查询整棵树');
});

test('点击必须有两次独立稳定观测，下一次点击重新读取界面', async () => {
  const { device, events } = navigationDevice(read => ({ x: read <= 2 ? 20 : 200 }));
  await tap(device, 'confirm-button');
  await tap(device, 'confirm-button');
  assert.deepEqual(events, [
    '读取界面', '读取界面', { x: 60, y: 120 },
    '读取界面', '读取界面', { x: 240, y: 120 },
  ], '点击后不能沿用上次观测的位置，也不能省略第二次稳定观测');
});

test('布局移动后必须等新的相邻观测一致才点击新位置', async () => {
  const { device, events } = navigationDevice(read => ({ x: read === 1 ? 20 : 200 }));
  await tap(device, 'confirm-button');
  assert.deepEqual(events, ['读取界面', '读取界面', '读取界面', { x: 240, y: 120 }]);
});

test('最后一次稳定观测的祖先已隐藏或裁切时拒绝点击', async () => {
  for (const changed of [{ visible: false }, { viewportHeight: 110 }]) {
    const { device, events } = navigationDevice(read => read === 1 ? {} : changed);
    await assert.rejects(tap(device, 'confirm-button'), /点击位置仍被祖先裁切/);
    assert.deepEqual(events, ['读取界面', '读取界面'], '不能用首次观测的祖先几何绕过当前裁切');
  }
});

test('第二次原生观测失败必须传播错误，不能使用旧快照点击', async () => {
  const failure = new Error('原生驱动连接中断');
  const { device, events } = navigationDevice(read => { if (read === 2) throw failure; return {}; });
  await assert.rejects(tap(device, 'confirm-button'), error => error === failure);
  assert.deepEqual(events, ['读取界面']);
});
