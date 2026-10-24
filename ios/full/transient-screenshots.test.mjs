import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { captureTransientScreenshots } from './transient-screenshots.ts';

test('one event is bracketed by real timestamped screenshots, including its expiry', async () => {
  let visible = false, triggers = 0;
  const attachments = new Map();
  const result = await captureTransientScreenshots({ screenshot: async () => {
    await delay(3);
    return Buffer.from([visible ? 1 : 0]);
  } }, 'transient-test', { attach: async (name, options) => {
    attachments.set(name, options.path ? await readFile(options.path) : options.body);
  } }, async () => {
    triggers++;
    visible = true;
    setTimeout(() => { visible = false; }, 100);
    return '+10';
  }, 200, 8);
  assert.equal(triggers, 1);
  assert.equal(result.result, '+10');
  assert.equal(result.frames[0][0], 0);
  assert.ok(result.frames.some(frame => frame[0] === 1));
  assert.equal(result.frames.at(-1)[0], 0);
  assert.ok(result.frames.timestampsMs.every((time, index, all) => index === 0 || time > all[index - 1]));
  assert.equal(attachments.get('transient-test-screenshot-frame-0')[0], 0);
  assert.equal(attachments.get(`transient-test-screenshot-frame-${result.frames.length - 1}`)[0], 0);
  const timeline = JSON.parse(attachments.get('transient-test-screenshot-timeline'));
  assert.equal(timeline.count, result.frames.length);
  assert.ok(timeline.triggeredAtMs > timeline.timestampsMs[0]);
});
