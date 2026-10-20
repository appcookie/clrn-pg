import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGuestClubReady, assertClubReady, waitForGuestClubReady } from './guest-club-ready.ts';
import { revealScenarioReady } from './navigation.ts';

const screen = { width: 1178, height: 2556 };
function node(res, bounds, children = [], clazz = 'XCUIElementTypeOther') {
  return { res, bounds, children, clazz, visible: true, enabled: true };
}
function actualClubLayout() {
  // d41412e zh-Hant CI: only the mount is absent from the visible flat list.
  const mount = node('club-tab-screen', { x: 0, y: 291, width: 1178, height: 2016 });
  mount.visible = false;
  const room = node('club_tab_room', { x: 0, y: 291, width: 591, height: 147 });
  const myClub = node('club_tab_my_club', { x: 587, y: 291, width: 591, height: 147 });
  const tabs = node('tabs', { x: 0, y: 291, width: 1178, height: 147 }, [room, myClub], 'XCUIElementTypeScrollView');
  const banner = node('not-sign-in-container', { x: 0, y: 435, width: 1178, height: 255 });
  const content = node('content', { x: 0, y: 435, width: 1178, height: 1872 }, [banner], 'XCUIElementTypeScrollView');
  const root = node('app', { x: 0, y: 0, ...screen }, [mount, tabs, content], 'XCUIElementTypeApplication');
  return { root, tabs, content, room, myClub, banner, nodes: [root, tabs, room, myClub, content, banner] };
}

test('真实繁体游客俱乐部以两个内部页签和登录横幅就绪，不查找或滚动隐藏挂载点', async () => {
  const { nodes } = actualClubLayout();
  const device = {
    screenSize: screen, nodes: async () => nodes,
    wait: async ({ res }) => assert.ok(nodes.some(node => node.res === res), `必须等待真正可见的${res}`),
    input: { swipe: async () => assert.fail('已显示的游客俱乐部不应被继续滚动') },
  };
  await waitForGuestClubReady(device);
});

test('只有其他页面共用的游客横幅或隐藏club挂载点不能冒充俱乐部就绪', () => {
  const { banner, root } = actualClubLayout();
  assert.throws(() => assertGuestClubReady([banner], screen), /club_tab_room/);
  assert.throws(() => assertGuestClubReady([root], screen), /club_tab_room/);
});

test('俱乐部页签缺失、重复或游客横幅被真实祖先裁切时失败', () => {
  const layout = actualClubLayout();
  assert.throws(() => assertGuestClubReady(layout.nodes.filter(node => node !== layout.myClub), screen), /club_tab_my_club/);
  assert.throws(() => assertGuestClubReady([...layout.nodes, structuredClone(layout.room)], screen), /唯一/);
  layout.content.bounds.height = 100;
  assert.throws(() => assertGuestClubReady(layout.nodes, screen), /被裁切.*not-sign-in-container/);
  layout.content.bounds.height = 1872;
  layout.content.visible = false;
  assert.throws(() => assertGuestClubReady(layout.nodes, screen), /被裁切.*not-sign-in-container/);
});

test('已登录俱乐部与战绩入口只验证已登录内容，不误等游客横幅', async () => {
  const layout = actualClubLayout();
  layout.content.children = [];
  const nodes = layout.nodes.filter(node => node !== layout.banner);
  const queries = [];
  const device = { screenSize: screen, nodes: async () => nodes,
    wait: async ({ res }) => { queries.push(res); assert.ok(nodes.some(node => node.res === res)); } };
  for (const pageLabel of ['signed_in_club', 'club_records']) {
    await revealScenarioReady(device, { pageLabel, signIn: true, visualReadySelector: '[data-testid="club-tab-screen"]' });
  }
  assert.ok(!queries.includes('not-sign-in-container'));
  assert.ok(!queries.includes('club-tab-screen'));
  assert.throws(() => assertClubReady(layout.nodes, screen, true), /不应显示游客登录横幅/);
  const alert = node('error', { x: 100, y: 100, width: 500, height: 500 }, [], 'XCUIElementTypeAlert');
  assert.throws(() => assertClubReady([...nodes, alert], screen, true), /系统弹窗/);
});

test('仅明确游客场景使用游客就绪分支，缺失身份不默认为游客或已登录', async () => {
  const { nodes } = actualClubLayout();
  const device = { screenSize: screen, nodes: async () => nodes,
    wait: async ({ res }) => assert.ok(nodes.some(node => node.res === res)) };
  const scenario = { pageLabel: 'guest_club', signIn: false, visualReadySelector: '[data-testid="club-tab-screen"]' };
  await revealScenarioReady(device, scenario);
  await assert.rejects(revealScenarioReady(device, { ...scenario, signIn: undefined }), /需要明确/);
  await assert.rejects(revealScenarioReady(device, { ...scenario, pageLabel: 'unknown_club' }), /需要明确/);
  assert.throws(() => assertClubReady(nodes, screen, undefined), /明确声明登录状态/);
});
