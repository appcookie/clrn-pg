import test from 'node:test';
import assert from 'node:assert/strict';
import { observeRenewExitPress } from './renew-exit-diagnostics.ts';

const bounds = { x: 10, y: 20, width: 30, height: 40 };
const screen = { width: 120, height: 180 };

test('其他动作不增加诊断或包装输入', () => {
  const press = async () => {};
  for (const args of [['texas-holdem', 'renew', 'exit'], ['zhajinhua', 'theme', 'exit'],
    ['zhajinhua', 'renew', 'enter']]) {
    assert.equal(observeRenewExitPress(...args, bounds, screen, press), press);
  }
});
