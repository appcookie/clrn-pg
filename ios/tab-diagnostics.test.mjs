import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTabWithDiagnostics } from './tab-diagnostics.mjs';

const xml = `<AppiumAUT><XCUIElementTypeApplication type="XCUIElementTypeApplication">
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="club-tab" value="1" enabled="true" visible="true" x="235" y="769" width="80" height="49"/>
  <XCUIElementTypeButton type="XCUIElementTypeButton" name="settings-tab" enabled="true" visible="true" x="314" y="769" width="79" height="49"/>
  <XCUIElementTypeOther visible="false"><XCUIElementTypeAlert type="XCUIElementTypeAlert" name="alert" visible="true"/></XCUIElementTypeOther>
  <XCUIElementTypeOther type="XCUIElementTypeOther" name="popup-content-container" label="secret" visible="true"/>
  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="private-account" value="secret" visible="true"/>
</XCUIElementTypeApplication></AppiumAUT>`;

test('标签诊断只输出可见标签几何与固定遮挡标识，保留同一个失败对象且不补点', async () => {
  const failure = new Error('标签切换未生效：settings-tab');
  const observations = [];
  const calls = [];
  const driver = {
    async source() { calls.push('source'); return xml; },
    async selectTab(identifier) { calls.push(identifier); throw failure; },
  };
  await assert.rejects(selectTabWithDiagnostics(driver, 'settings-tab', observations), error => error === failure);
  assert.deepEqual(calls, ['source', 'settings-tab', 'source']);
  assert.deepEqual(observations.map(item => item.phase), ['before', 'failed']);
  assert.deepEqual(observations[0].tabs, [
    { identifier: 'club-tab', selected: true, enabled: true, rect: { x: 235, y: 769, width: 80, height: 49 } },
    { identifier: 'settings-tab', selected: false, enabled: true, rect: { x: 314, y: 769, width: 79, height: 49 } },
  ]);
  assert.deepEqual(observations[0].blockers, ['popup-content-container']);
  assert.deepEqual(observations[0].modalTypes, []);
  assert.doesNotMatch(JSON.stringify(observations), /secret|private-account/);
});

test('取证失败和保存失败都不能覆盖原始切换异常', async () => {
  const failure = new Error('original WDA failure');
  const driver = { async source() { throw new Error('diagnostic failure'); }, async selectTab() { throw failure; } };
  await assert.rejects(selectTabWithDiagnostics(driver, 'settings-tab', []), error => error === failure);
  driver.source = async () => xml;
  await assert.rejects(selectTabWithDiagnostics(driver, 'settings-tab', Object.freeze([])), error => error === failure);
});

test('切换成功时保持返回值且不在截图动画采样前增加结束查询', async () => {
  const calls = [];
  const driver = {
    async source() { calls.push('source'); throw new Error('diagnostic failure'); },
    async selectTab(identifier) { calls.push(identifier); return 'result'; },
  };
  assert.equal(await selectTabWithDiagnostics(driver, 'settings-tab', []), 'result');
  assert.deepEqual(calls, ['source', 'settings-tab']);
});
