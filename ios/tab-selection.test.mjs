import test from 'node:test';
import assert from 'node:assert/strict';
import { WebDriver } from './webdriver.mjs';
import { scenarios, tabPages } from './scenarios.mjs';

// The tab geometry, selected value and hidden alerts match run 42441832380's WDA source.
function source(state) {
  const tabs = ['message-tab', 'private-room-tab', 'hall-tab', 'club-tab', 'settings-tab'].map((tab, index) => `<XCUIElementTypeButton type="XCUIElementTypeButton"
    name="${tab}" value="${tab === state.selected ? '1' : ''}" visible="true" enabled="${state.enabled}"
    x="${index * 78 + state.offset}" y="769" width="80" height="50"/>`).join('');
  const ready = state.ready.map(tab => `<XCUIElementTypeOther type="XCUIElementTypeOther"
    name="${tabPages[tab]}" visible="${state.readyVisible}" x="0" y="64" width="393" height="84"/>`).join('');
  return `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication" x="0" y="0" width="393" height="852">
    <XCUIElementTypeOther type="XCUIElementTypeOther" name="alert" visible="false"/>
    ${tabs}${ready}${state.overlay}
    </XCUIElementTypeApplication></AppiumAUT>`;
}

function fixture({ onTap = () => {}, onRead = () => {} } = {}) {
  const state = { selected: 'message-tab', ready: ['message-tab'], readyVisible: true,
    enabled: true, offset: 0, overlay: '', reads: 0, taps: [], events: [] };
  const driver = new WebDriver();
  driver.session = 'test-session';
  driver.request = async (method, path, body) => {
    if (method === 'GET' && path.endsWith('/source')) {
      state.reads++;
      onRead(state);
      return source(state);
    }
    assert.equal(method, 'POST');
    assert.equal(path, '/session/test-session/execute/sync');
    assert.equal(body.script, 'mobile: tap');
    state.taps.push(body.args[0]);
    onTap(state);
    return null; // Just like the failed CI tap: HTTP success alone proves nothing.
  };
  const select = (identifier = 'private-room-tab') => driver.selectTab(identifier, {
    pages: tabPages, timeout: 100, interval: 1, onObservation: event => state.events.push(event),
  });
  return { state, select };
}

function arrive(state) {
  state.selected = 'private-room-tab';
  state.ready = ['private-room-tab'];
}

test('a missed first touch retries once with fresh geometry and verifies the destination', async () => {
  const { state, select } = fixture({ onTap(state) {
    if (state.taps.length === 1) state.offset = 4;
    else arrive(state);
  } });
  await select();
  assert.deepEqual(state.taps, [{ x: 118, y: 794 }, { x: 122, y: 794 }]);
  assert.equal(state.events.filter(event => event.phase === 'retry').length, 1);
  assert.equal(state.events.at(-1).phase, 'complete');
  assert.equal(state.events.at(-1).selected, 'private-room-tab');
  assert.deepEqual(state.events.at(-1).ready, ['private-room-tab']);
});

test('persistent successful-but-ineffective commands still fail after exactly two touches', async () => {
  const { state, select } = fixture();
  await assert.rejects(select(), /标签切换未生效/);
  assert.equal(state.taps.length, 2);
  assert.equal(state.events.at(-1).phase, 'failed');
  assert.equal(state.events.at(-1).selected, 'message-tab');
});

test('a successful first touch needs no retry', async () => {
  const { state, select } = fixture({ onTap: arrive });
  await select();
  assert.equal(state.taps.length, 1);
  assert.ok(!state.events.some(event => event.phase === 'retry'));
});

test('an already selected tab is accepted only with its ready page, without tapping', async () => {
  const { state, select } = fixture();
  arrive(state);
  await select();
  assert.equal(state.taps.length, 0);
  assert.ok(state.reads >= 2);
});

test('hall readiness uses visible content while its sign-in button is below the viewport (run 42509433345)', async () => {
  assert.equal(tabPages['hall-tab'], 'hall-content-list');
  assert.equal(scenarios.find(scenario => scenario.name === 'hall').ready, 'hall-sign-in-button');
  const { state, select } = fixture();
  state.selected = 'hall-tab';
  state.ready = [];
  state.overlay = `<XCUIElementTypeOther type="XCUIElementTypeOther" name="hall-content-list"
    visible="true" x="0" y="97" width="393" height="672"/>
    <XCUIElementTypeOther type="XCUIElementTypeOther" name="hall-sign-in-button"
    visible="false" x="140" y="870" width="393" height="46"/>`;
  await select('hall-tab');
  assert.equal(state.taps.length, 0);
  assert.deepEqual(state.events.at(-1).ready, ['hall-tab']);
  state.overlay = state.overlay.replace('visible="true"', 'visible="false"');
  await assert.rejects(select('hall-tab'), /标签布局或原页面未就绪/);
  assert.equal(state.taps.length, 0);
});

test('selection without destination content must fail rather than retry the selected tab', async () => {
  const { state, select } = fixture({ onTap(state) { state.selected = 'private-room-tab'; } });
  await assert.rejects(select(), /标签切换未生效/);
  assert.equal(state.taps.length, 1);
});

test('a selected destination can finish loading without receiving a second tap', async () => {
  let loadingReads = 0;
  const { state, select } = fixture({
    onTap(state) { state.selected = 'private-room-tab'; state.ready = []; },
    onRead(state) { if (state.taps.length && ++loadingReads === 3) state.ready = ['private-room-tab']; },
  });
  await select();
  assert.equal(loadingReads, 3);
  assert.equal(state.taps.length, 1);
});

test('content which is mounted but hidden is not destination readiness', async () => {
  const { state, select } = fixture({ onTap(state) { arrive(state); state.readyVisible = false; } });
  await assert.rejects(select(), /标签切换未生效/);
  assert.equal(state.taps.length, 1);
});

test('layout changes must settle before the first native tap', async () => {
  const { state, select } = fixture({ onTap: arrive, onRead(state) {
    if (state.reads <= 3) state.offset = state.reads;
  } });
  await select();
  assert.deepEqual(state.taps, [{ x: 121, y: 794 }]);
  assert.ok(state.reads >= 5);
});

test('a continuously moving tab is never tapped', async () => {
  const { state, select } = fixture({ onRead(state) { state.offset = state.reads % 2; } });
  await assert.rejects(select(), /标签布局或原页面未就绪/);
  assert.equal(state.taps.length, 0);
});

for (const type of ['XCUIElementTypeAlert', 'XCUIElementTypeKeyboard', 'XCUIElementTypeSheet']) {
  test(`${type} blocks a retry even if the previous page remains mounted`, async () => {
    const { state, select } = fixture({ onTap(state) { state.overlay = `<${type} type="${type}" visible="true"/>`; } });
    await assert.rejects(select(), /标签切换被遮挡/);
    assert.equal(state.taps.length, 1);
    assert.deepEqual(state.events.at(-1).blockers, [type]);
  });
}

test('an application modal blocks the first touch', async () => {
  const { state, select } = fixture();
  state.overlay = '<XCUIElementTypeOther type="XCUIElementTypeOther" name="popup-content-container" visible="true"/>';
  await assert.rejects(select(), /标签切换被遮挡/);
  assert.equal(state.taps.length, 0);
});

test('a modal appearing while preparing a retry cancels the second touch', async () => {
  const { state, select } = fixture({ onRead(state) {
    if (state.events.some(event => event.phase === 'retry')) {
      state.overlay = '<XCUIElementTypeAlert type="XCUIElementTypeAlert" visible="true"/>';
    }
  } });
  await assert.rejects(select(), /标签切换被遮挡/);
  assert.equal(state.taps.length, 1);
});

test('a different page appearing before the retry cancels the second touch', async () => {
  const { state, select } = fixture({ onRead(state) {
    if (state.events.some(event => event.phase === 'retry')) {
      state.selected = 'club-tab'; state.ready = ['club-tab'];
    }
  } });
  await assert.rejects(select(), /标签重试前原页面已改变/);
  assert.equal(state.taps.length, 1);
});

test('disabled or offscreen targets are never tapped', async () => {
  for (const change of [{ enabled: false }, { offset: 400 }]) {
    const { state, select } = fixture();
    Object.assign(state, change);
    await assert.rejects(select(), /标签不可点击/);
    assert.equal(state.taps.length, 0);
  }
});

test('an unexpected third tab is an error, not a reason to retry', async () => {
  const { state, select } = fixture({ onTap(state) { state.selected = 'club-tab'; state.ready = ['club-tab']; } });
  await assert.rejects(select(), /标签切换进入意外页面/);
  assert.equal(state.taps.length, 1);
});

test('loss of original page readiness prevents a retry', async () => {
  const { state, select } = fixture({ onTap(state) { state.ready = []; } });
  await assert.rejects(select(), /标签切换未生效/);
  assert.equal(state.taps.length, 1);
});

test('transport failures propagate immediately without retrying the gesture', async () => {
  const error = new Error('WDA disconnected');
  const { state, select } = fixture({ onTap() { throw error; } });
  await assert.rejects(select(), error);
  assert.equal(state.taps.length, 1);
});

test('selecting Me verifies its landing page before the login scenario opens a child page', () => {
  assert.equal(tabPages['settings-tab'], 'after-sign-in-see-asset-text');
  assert.equal(Object.keys(tabPages).length, 5);
});
