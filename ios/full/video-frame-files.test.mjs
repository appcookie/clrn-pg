import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRecordedFrameFiles } from './video-frame-files.ts';

test('批量读取原生帧期间仍服务本进程HTTP夹具，保留每个字节和磁盘帧序', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-frames-'));
  let finished = false, servedDuringRead = 0;
  const server = createServer((_request, response) => {
    if (!finished) servedDuringRead++;
    response.end('fixture-ready');
  });
  try {
    const expected = Array.from({ length: 128 }, (_, index) => Buffer.alloc(128 * 1024, index));
    // Deliberately create files backwards; directory enumeration is not frame order.
    for (let index = expected.length - 1; index >= 0; index--)
      await writeFile(path.join(directory, `frame-${String(index).padStart(4, '0')}.png`), expected[index]);
    await writeFile(path.join(directory, 'unrelated.json'), '{}');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const request = () => new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${server.address().port}`, incoming => {
        let text = '';
        incoming.on('data', chunk => { text += chunk; });
        incoming.on('end', () => resolve(text));
      }).on('error', reject);
    });
    const requests = (async () => {
      while (!finished) assert.equal(await request(), 'fixture-ready');
    })();
    let frames;
    try { frames = await readRecordedFrameFiles(directory, expected.length); }
    finally { finished = true; }
    await requests;
    assert.ok(servedDuringRead >= 2, '不能只在读取目录前响应一次，逐帧读盘期间也必须持续服务HTTP');
    assert.deepEqual(frames, expected);
    await assert.rejects(readRecordedFrameFiles(directory, expected.length - 1), /帧数与真实录屏时戳不一致/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('原生帧读盘错误必须失败，不能丢帧补帧或返回部分轨迹', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'invalid-native-frames-'));
  try {
    await writeFile(path.join(directory, 'frame-0000.png'), Buffer.from([1, 2, 3]));
    await mkdir(path.join(directory, 'frame-0001.png'));
    await assert.rejects(readRecordedFrameFiles(directory, 2), { code: 'EISDIR' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
