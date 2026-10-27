import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeThemeSettings, gameMenu, waitForRecordedDrawerMenu } from './game-pregame.ts';

const bounds = x => ({ x, y: 100, width: 20, height: 20 });
const node = (res, x, text = '') => ({ res, text, bounds: bounds(x), enabled: true, visible: true });
const menu = node('menu-button', 10);
const theme = node('drawer-menu-item-theme', 40);
const drawerExit = node('drawer-menu-item-exit', 70);
const panel = node('game-settings-card-theme-simple', 100);
const connecting = node('connection', 200, 'Connecting...');

test('菜单录屏已展开侧栏时，重连遮罩退去后才确认真实菜单', async () => {
  let connectionReads = 0, menuReads = 0, fullReads = 0, taps = 0;
  const device = {
    screenSize: { width: 1178, height: 2556 },
    prepareTransientCapture: async () => {},
    inputObservation: async target => {
      if (target === 'drawer-menu-item-exit') { menuReads++; return []; }
      return ++connectionReads <= 2 ? [connecting] : [];
    },
    nodes: async () => {
      assert.ok(connectionReads >= 3, '连接恢复前不得把遮罩下的控件树判为菜单缺失');
      fullReads++;
      return [drawerExit];
    },
    input: { tap: async () => { taps++; } },
  };
  await waitForRecordedDrawerMenu(device);
  assert.ok(connectionReads >= 4, '连接恢复后仍须连续观测');
  assert.equal(menuReads, 1);
  assert.equal(fullReads, 1);
  assert.equal(taps, 0, '已成功录下的菜单入场不得再次点击');
});

test('menu navigation retries the UI tap only after reconnect leaves the drawer open', async () => {
  let state = 'table', connectionReads = 0, themeTaps = 0, rich = false;
  const visible = () => state === 'table' ? [menu]
    : state === 'drawer' ? [theme, drawerExit]
      : state === 'connecting' ? [connecting] : [panel];
  const device = {
    screenSize: { width: 1178, height: 2556 },
    nodes: async () => visible(),
    prepareTransientCapture: async () => { rich = true; },
    inputObservation: async names => {
      assert.ok(rich, 'focused XCTest observation requires response attributes');
      if (state === 'connecting' && ++connectionReads >= 2) state = 'drawer';
      const targets = Array.isArray(names) ? names : names ? [names] : [];
      return visible().filter(item => targets.includes(item.res) || item === connecting);
    },
    input: { tap: async ({ x }) => {
      if (x === 20) state = 'drawer';
      else if (x === 50) {
        themeTaps++;
        state = themeTaps === 1 ? 'connecting' : 'panel';
      } else throw new Error(`unexpected tap ${x}`);
    } },
  };
  await gameMenu(device, 'theme', panel.res);
  assert.equal(themeTaps, 2);
  assert.equal(state, 'panel');
});

test('menu navigation does not repeat a successful tap', async () => {
  let state = 'table', themeTaps = 0, rich = false, fullTreeReads = 0;
  const visible = () => state === 'table' ? [menu] : state === 'drawer' ? [theme, drawerExit] : [panel];
  const device = {
    screenSize: { width: 1178, height: 2556 },
    nodes: async () => { fullTreeReads++; return visible(); },
    prepareTransientCapture: async () => { rich = true; },
    inputObservation: async names => {
      assert.ok(rich, 'focused XCTest observation requires response attributes');
      return visible().filter(item =>
        (Array.isArray(names) ? names : names ? [names] : []).includes(item.res));
    },
    input: { tap: async ({ x }) => {
      if (x === 20) state = 'drawer';
      else if (x === 50) { themeTaps++; state = 'panel'; }
      else throw new Error(`unexpected tap ${x}`);
    } },
  };
  await gameMenu(device, 'theme', panel.res);
  assert.equal(themeTaps, 1);
  assert.equal(state, 'panel');
  assert.equal(fullTreeReads, 0, 'healthy menu navigation only needs focused native observations');
});

test('menu navigation checks the live tree when a focused query misses an open drawer', async () => {
  let state = 'table', themeTaps = 0, rich = false, fullTreeReads = 0;
  const visible = () => state === 'table' ? [menu]
    : state === 'drawer' ? [theme, drawerExit] : [panel];
  const device = {
    screenSize: { width: 1178, height: 2556 },
    nodes: async () => { fullTreeReads++; return visible(); },
    prepareTransientCapture: async () => { rich = true; },
    inputObservation: async names => {
      assert.ok(rich);
      const targets = Array.isArray(names) ? names : names ? [names] : [];
      // Reproduce CI: the menu is visibly open, but this predicate omits the
      // exit marker during the post-tap state check.
      if (state === 'drawer' && targets.includes(drawerExit.res)) return [];
      return visible().filter(item => targets.includes(item.res));
    },
    input: { tap: async ({ x }) => {
      if (x === 20) state = 'drawer';
      else if (x === 50) { themeTaps++; state = themeTaps === 1 ? 'drawer' : 'panel'; }
      else throw new Error(`unexpected tap ${x}`);
    } },
  };
  await gameMenu(device, 'theme', panel.res);
  assert.equal(themeTaps, 2);
  assert.equal(state, 'panel');
  assert.ok(fullTreeReads >= 1, 'ambiguous absence must be checked against the live tree');
});

test('theme close retries once only when the live tree still contains the same panel', async () => {
  const close = node('game-settings-close-button', 10);
  let open = true, taps = 0;
  const visible = () => open ? [close, panel] : [];
  const device = {
    screenSize: { width: 1178, height: 2556 },
    nodes: async () => visible(),
    prepareTransientCapture: async () => {},
    inputObservation: async names => visible().filter(item => names === item.res),
    input: { tap: async () => { if (++taps === 2) open = false; } },
  };
  await closeThemeSettings(device);
  assert.equal(taps, 2);
  assert.equal(open, false);
});
