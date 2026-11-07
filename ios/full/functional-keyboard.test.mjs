import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeCase } from './functional/shared/case.ts';

function keyboardDevice() {
  const events = [];
  let keyboardVisible = false;
  const node = res => ({ res, enabled: true, clazz: 'XCUIElementTypeOther',
    bounds: { x: 100, y: 1500, width: 400, height: 80 }, children: [] });
  const controls = ['staging-confirmation-input', 'confirm-button', 'hall-tab',
    'username-input', 'password-input', 'sign-in-button'].map(node);
  const device = {
    screenSize: { width: 1000, height: 2000 },
    wait: async () => {},
    waitSnapshot: async () => device.nodes(),
    info: async selector => node(selector.res),
    nodes: async () => [...controls, ...(keyboardVisible ? [{
      clazz: 'XCUIElementTypeKeyboard', bounds: { x: 0, y: 1300, width: 1000, height: 700 }, children: [],
    }] : [])],
    fill: async selector => {
      events.push(`fill:${selector.res}`);
      keyboardVisible = true;
    },
    hideKeyboard: async () => {
      assert.equal(keyboardVisible, true, '输入之后键盘确实可见');
      events.push('hide-keyboard');
      await Promise.resolve();
      keyboardVisible = false;
    },
    terminate: async () => { events.push('terminate'); },
    input: {
      tap: async point => {
        assert.equal(keyboardVisible && point.y >= 1300, false, '坐标点击落入可见键盘，不能提交表单');
        events.push('coordinate-tap');
      },
    },
  };
  return { device, events };
}

test('hall填写CONFIRM后先等待安全收键盘，再通过原导航方法坐标点击确认', async () => {
  const { device, events } = keyboardDevice();
  const ui = new NativeCase(device, {});
  await ui.hall();
  assert.deepEqual(events, ['fill:staging-confirmation-input', 'hide-keyboard', 'coordinate-tap']);
});

test('signIn每次输入后收键盘，HTTP观测仍在真实坐标提交之前建立', async () => {
  const { device, events } = keyboardDevice();
  const ui = new NativeCase(device, {});
  ui.loginForm = async () => {};
  ui.network.waitForResponse = async (match, action) => {
    assert.equal(match.path, '/public/v10/user/login/username/password');
    events.push('observe-login');
    await action();
    throw new Error('合成设备在提交处结束，不请求后端或伪造成功登录');
  };
  await assert.rejects(ui.signIn({ username: 'synthetic-user', password: 'synthetic-password' }), /原生真实登录/);
  assert.deepEqual(events, [
    'fill:username-input', 'hide-keyboard', 'fill:password-input', 'hide-keyboard',
    'observe-login', 'coordinate-tap', 'terminate',
  ]);
});
