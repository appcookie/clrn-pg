import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { attachFrameEvidence } from './frame-evidence.ts';

test('诊断帧按路径附加，原始PNG完整保留且不内嵌报告；临时文件复制后清理', async () => {
  const bytes = PNG.sync.write(new PNG({ width: 7, height: 9 }));
  let saved;
  await attachFrameEvidence({ attach: async (name, options) => {
    assert.equal(name, 'transition-frame-5');
    assert.equal(options.contentType, 'image/png');
    assert.equal(options.body, undefined);
    assert.deepEqual(await readFile(options.path), bytes);
    saved = options.path;
  } }, 'transition-frame-5', bytes);
  await assert.rejects(access(saved), { code: 'ENOENT' });
});

test('附件保存失败必须传播，不能默默丢帧，失败后也清理临时文件', async () => {
  let saved;
  const failure = Error('artifact write failed');
  await assert.rejects(attachFrameEvidence({ attach: async (_name, options) => {
    saved = options.path; throw failure;
  } }, 'frame', Buffer.from('fixture')), error => error === failure);
  await assert.rejects(access(saved), { code: 'ENOENT' });
});
