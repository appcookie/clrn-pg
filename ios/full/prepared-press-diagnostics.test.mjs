import test from 'node:test';
import assert from 'node:assert/strict';
import { observePreparedPress } from './prepared-press-diagnostics.ts';

const bounds = { x: 10, y: 20, width: 30, height: 40 };
const screen = { width: 120, height: 180 };

test('点击诊断保留单次输入和准备/请求时序，只输出几何与时间', async () => {
  const events = [];
  let evidence;
  const press = observePreparedPress('texas drawer menu', bounds, screen,
    async () => { events.push('tap'); }, body => {
      events.push('diagnostic');
      evidence = JSON.parse(body);
    });
  assert.deepEqual(events, []);
  await press();
  assert.deepEqual(events, ['tap', 'diagnostic']);
  assert.deepEqual(evidence.bounds, bounds);
  assert.deepEqual(evidence.preparedCenter, { x: 25, y: 40 });
  assert.deepEqual(evidence.screen, screen);
  assert.equal(evidence.returned, true);
  assert.ok(Date.parse(evidence.preparedUtc) <= Date.parse(evidence.requestedUtc));
  assert.ok(Date.parse(evidence.requestedUtc) <= Date.parse(evidence.completedUtc));
});

test('诊断写出失败不改变输入成功或覆盖同一个输入异常', async () => {
  for (const original of [undefined, new Error('input failed')]) {
    let taps = 0;
    const press = observePreparedPress('texas drawer menu', bounds, screen,
      async () => {
        taps++;
        if (original) throw original;
      }, () => { throw new Error('diagnostic failed'); });
    if (original) await assert.rejects(press(), error => error === original);
    else await press();
    assert.equal(taps, 1);
  }
});
