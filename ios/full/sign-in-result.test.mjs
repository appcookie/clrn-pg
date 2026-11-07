import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForSignInResult } from './sign-in-result.ts';

function fixture(message, recovered = true) {
  let submits = 0, accepts = 0;
  return {
    device: {
      nodes: async () => submits === 2 && recovered
        ? [{ res: 'settings-tab', visible: true }] : [{ clazz: 'XCUIElementTypeAlert', visible: true }],
      alertText: async () => message,
      acceptAlert: async () => { accepts++; },
    },
    submit: async () => { submits++; },
    counts: () => [submits, accepts],
  };
}
test('confirmed login 502 permits exactly one real resubmission', async () => {
  const f = fixture('Request failed with status code 502');
  await waitForSignInResult(f.device, f.submit);
  assert.deepEqual(f.counts(), [2, 1]);
});
test('persistent gateway failure remains a failure after one resubmission', async () => {
  const f = fixture('Request failed with status code 502', false);
  await assert.rejects(waitForSignInResult(f.device, f.submit), /错误弹窗/);
  assert.deepEqual(f.counts(), [2, 1]);
});
test('credential and other application errors never resubmit', async () => {
  const f = fixture('Invalid password');
  await assert.rejects(waitForSignInResult(f.device, f.submit), /错误弹窗/);
  assert.deepEqual(f.counts(), [1, 0]);
});
test('successful login does not resubmit', async () => {
  const f = fixture('');
  f.device.nodes = async () => [{ res: 'settings-tab', visible: true }];
  await waitForSignInResult(f.device, f.submit);
  assert.deepEqual(f.counts(), [1, 0]);
});
