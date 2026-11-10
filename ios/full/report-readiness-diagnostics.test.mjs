import test from 'node:test';
import assert from 'node:assert/strict';
import { reportReadinessDiagnostic } from './game-controls.ts';

for (const resource of ['report-field-input', 'drawer-menu-item-exit', 'room-connection'])
  test(`${resource} 就绪诊断只复用最近16份样本，日志故障保留原异常`, async () => {
  const diagnostic = reportReadinessDiagnostic(resource);
  const failure = new Error('original');
  const previous = console.error;
  let samples;
  try {
    console.error = (_label, json) => { samples = JSON.parse(json); };
    for (let index = 0; index < 20; index++) diagnostic.record([
      { res: resource, text: 'private-input' },
      { res: 'menu-button', text: 'private-menu' },
      { res: 'report-popup-title', text: 'private-title' },
      { text: 'Connecting...' },
    ], index);
    await assert.rejects(diagnostic.wait(async () => { throw failure; }), error => error === failure);
    assert.equal(samples.length, 16);
    assert.equal(samples[0].queryMs, 4);
    assert.equal(samples[15].targetPresent, true);
    assert.equal(samples[15].connecting, true);
    assert.equal(samples[15].menuPresent, true);
    assert.equal(samples[15].drawerPresent, resource === 'drawer-menu-item-exit');
    assert.ok(!JSON.stringify(samples).includes('private'));
    console.error = () => { throw new Error('diagnostic'); };
    await assert.rejects(diagnostic.wait(async () => { throw failure; }), error => error === failure);
  } finally { console.error = previous; }
});

test('其他控件不记录举报诊断，成功结果不增加观测', async () => {
  const diagnostic = reportReadinessDiagnostic('other');
  let called = false;
  diagnostic.record([{ res: 'report-field-input', text: 'private' }], 1);
  await diagnostic.wait(async () => { called = true; });
  assert.equal(called, true);
});
