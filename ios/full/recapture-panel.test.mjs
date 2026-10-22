import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePanelWithMotionRecaptures } from './recapture-panel.ts';

test('missed sidebar movies stay diagnostic and a third real opening must pass', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recapture-panel-'));
  const ephemeral = join(directory, 'ephemeral.png');
  const events = [], attachments = [];
  const info = {
    outputPath: name => join(directory, name),
    attach: async (name, options) => { attachments.push({ name, options,
      bytes: options.path ? await readFile(options.path) : options.body }); },
  };
  let captures = 0;
  try {
    await capturePanelWithMotionRecaptures(info, async captureInfo => {
      captures++;
      assert.equal(captureInfo.outputPath('movie'), join(directory, 'movie'));
      await captureInfo.attach('personal-leaderboard-enter-start', { body: Buffer.from([1]), contentType: 'image/png' });
      await writeFile(ephemeral, Buffer.from([captures]));
      await captureInfo.attach('personal-leaderboard-enter-native-video', { path: ephemeral, contentType: 'video/mp4' });
      await rm(ephemeral);
      events.push(`capture-${captures}`);
      if (captures < 3) throw new Error('missed motion');
      await captureInfo.attach('personal-leaderboard-enter-start.png', { body: Buffer.from([2]), contentType: 'image/png' });
    }, async () => { events.push('close-and-reopen'); }, error => error.message === 'missed motion');
  } finally { await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual(events, ['capture-1', 'close-and-reopen', 'capture-2', 'close-and-reopen', 'capture-3']);
  assert.deepEqual(attachments.map(item => item.name), [
    'personal-leaderboard-enter-start-capture-1-missed-motion',
    'personal-leaderboard-enter-native-video-capture-1-missed-motion',
    'personal-leaderboard-enter-start-capture-2-missed-motion',
    'personal-leaderboard-enter-native-video-capture-2-missed-motion',
    'personal-leaderboard-enter-start', 'personal-leaderboard-enter-native-video',
    'personal-leaderboard-enter-start.png',
  ]);
  assert.ok(attachments[0].options.body.equals(Buffer.from([1])));
  assert.deepEqual([attachments[1].bytes[0], attachments[3].bytes[0], attachments[5].bytes[0]], [1, 2, 3]);
});

test('business or endpoint failure is preserved without reopening the panel', async () => {
  const attachments = [];
  const failure = new Error('wrong nickname');
  await assert.rejects(capturePanelWithMotionRecaptures({
    outputPath: name => name, attach: async name => { attachments.push(name); },
  }, async info => {
    await info.attach('native-endpoint', { body: '{}', contentType: 'application/json' });
    throw failure;
  }, async () => { throw new Error('must not reopen'); }, error => error.message === 'missed motion'),
  error => error === failure);
  assert.deepEqual(attachments, ['native-endpoint']);
});

test('three recordings without measured movement still fail the test', async () => {
  let captures = 0, resets = 0;
  const failure = new Error('missed motion');
  await assert.rejects(capturePanelWithMotionRecaptures({
    outputPath: name => name, attach: async () => {},
  }, async () => { captures++; throw failure; }, async () => { resets++; },
  error => error === failure), error => error === failure);
  assert.equal(captures, 3);
  assert.equal(resets, 2);
});
