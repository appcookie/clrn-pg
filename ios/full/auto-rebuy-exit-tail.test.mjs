import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { completedAutoRebuyExitFrame } from './animation-transition.ts';

const root = new URL('./fixtures/auto-rebuy-exit/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('provenance.json', root)));
const images = Object.fromEntries(provenance.frames.map(({ file, sha256 }) => {
  const bytes = readFileSync(new URL(file, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
  return [file, bytes];
}));

test('真实退场已完成约 107 ms 后才出现重连遮罩，选择原片中的完整退场帧', () => {
  const frames = [images['start.png'], images['start.png'], images['clean-15.png'],
    images['clean-20.png'], images['reconnect-24.png']];
  const result = completedAutoRebuyExitFrame(images['end.png'], frames,
    [0, 2576.667, 6953.333, 7060, 9953.333]);
  assert.equal(result.index, 3);
  assert.ok(result.distances[2] < 10 && result.distances[3] < 10);
  assert.ok(result.distances[4] > 10);
});

test('未持续到完整退场时拒绝用单一瞬间帧通过', () => {
  const frames = [images['start.png'], images['start.png'], images['clean-15.png'],
    images['reconnect-24.png'], images['reconnect-24.png']];
  assert.equal(completedAutoRebuyExitFrame(images['end.png'], frames,
    [0, 2576.667, 6953.333, 7060, 9953.333]).index, -1);
});

test('录屏末帧本身完成时保持原有末帧检查', () => {
  const frames = [images['start.png'], images['start.png'], images['clean-15.png'],
    images['clean-20.png'], images['end.png']];
  assert.equal(completedAutoRebuyExitFrame(images['end.png'], frames,
    [0, 2576.667, 6953.333, 7060, 9953.333]).index, 4);
});
