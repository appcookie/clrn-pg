import test from 'node:test';
import assert from 'node:assert/strict';
import { inputRequestTiming } from './input-request-diagnostics.mjs';
const filter = 'guest search confirmation animates into and out of the iOS screen$';
const path = '/session/SECRET/element/SECRET/click';

test('element-click timing exposes no request paths, identifiers or body', () => {
  const logs = [];
  const observe = inputRequestTiming('POST', path, filter, body => logs.push(body));
  observe(200); observe('transport-error');
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('SECRET'));
  const sample = JSON.parse(logs[0]);
  assert.equal(sample.status, 200);
  assert.ok(Date.parse(sample.completedUtc) >= Date.parse(sample.requestedUtc));
});

test('other requests have no diagnostic and logging failure cannot throw', () => {
  const fail = () => { throw new Error('diagnostic unavailable'); };
  inputRequestTiming('POST', path, filter, fail)('transport-error');
  let calls = 0;
  const write = () => { calls++; };
  inputRequestTiming('POST', path, '', write)(200);
  inputRequestTiming('GET', path, filter, write)(200);
  inputRequestTiming('POST', '/session/SECRET/element', filter, write)(200);
  assert.equal(calls, 0);
});
