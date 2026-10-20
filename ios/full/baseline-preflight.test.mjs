import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { animationCases } from './animation-gate.mjs';
import { baselineRelativePath } from './baseline-path.mjs';

test('compare 预检阻断缺图、删审查记录、改图和未补齐的动画', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ios-baseline-preflight-'));
  const root = join(directory, 'ios/snapshots/v1');
  const command = resolve('ios/full/baseline-preflight.mjs');
  const build = JSON.parse(readFileSync('ios/snapshots/v1/build-info.json', 'utf8'));
  const approved = JSON.parse(readFileSync('ios/snapshots/v1/review.json', 'utf8'));
  const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
  const files = animationCases[0].images.map(name => ({
    path: baselineRelativePath(name, 'en'), sha256: createHash('sha256').update(png).digest('hex'),
  }));
  const review = { ...approved, files };
  const writeReview = () => writeFileSync(join(root, 'review.json'), JSON.stringify(review));
  const run = (animation = 'animation-1') => spawnSync(process.execPath, [command], {
    cwd: directory, encoding: 'utf8', env: { ...process.env,
      IOS_CI_MATRIX: JSON.stringify({ include: [{ group: 'guest', locale: 'en', animation }] }) },
  });
  try {
    for (const file of files) {
      mkdirSync(dirname(join(root, file.path)), { recursive: true });
      writeFileSync(join(root, file.path), png);
    }
    writeFileSync(join(root, 'build-info.json'), JSON.stringify(build));
    writeReview();
    assert.equal(run().status, 0, '完整的测试夹具应通过');
    const removed = review.files.pop();
    rmSync(join(root, removed.path));
    assert.match(run().stderr, /缺图/);
    writeReview();
    assert.match(run().stderr, /动画门禁缺少基准/, '连同审查记录一起删图也必须失败');
    review.files.push(removed); writeReview();
    writeFileSync(join(root, removed.path), Buffer.concat([png, Buffer.from('changed')]));
    assert.match(run().stderr, /PNG 被修改/);
    writeFileSync(join(root, removed.path), png);
    writeFileSync(join(root, 'unreviewed.png'), png);
    assert.match(run().stderr, /未审查 PNG/);
    rmSync(join(root, 'unreviewed.png'));
    assert.notEqual(run('animation-2').status, 0, '没有该动画基准时不能让其他动画的图代替');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
