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
  const output = join(directory, 'github-output');
  const writeReview = () => writeFileSync(join(root, 'review.json'), JSON.stringify(review));
  const run = (animations = ['animation-1']) => {
    writeFileSync(output, '');
    return spawnSync(process.execPath, [command], {
      cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output,
        IOS_CI_MATRIX: JSON.stringify({ include: animations.map(animation => ({ group: 'guest', locale: 'en', animation })) }) },
    });
  };
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
    const incomplete = run(['animation-1', 'animation-2', 'animation-3']);
    assert.notEqual(incomplete.status, 0, '没有该动画基准时不能让其他动画的图代替');
    for (const entry of animationCases.slice(1, 3)) {
      for (const image of entry.images) assert.ok(incomplete.stderr.includes(baselineRelativePath(image, 'en')),
        `同一次失败必须报告每张缺失的基准：${image}`);
    }
    assert.ok(!incomplete.stderr.includes(baselineRelativePath(animationCases[0].images[0], 'en')),
      '已完整审查的分片不能被误报为缺失');
    assert.equal(readFileSync(output, 'utf8'), '', '图片缺失不能触发 reference 诊断');
    const reference = run(['animation-1', 'animation-14']);
    assert.match(reference.stderr, /animation-14 缺少完整审查后的动画基准清单/);
    assert.equal(readFileSync(output, 'utf8'), 'reference_cases=animation-14\n');
    writeFileSync(join(root, files[0].path), Buffer.concat([png, Buffer.from('changed')]));
    run(['animation-1', 'animation-14']);
    assert.equal(readFileSync(output, 'utf8'), '', '篡改基准时不能启动 reference 诊断');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
