import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Mitmproxy } from '../../e2e/helpers/mitmproxy-client.ts';
import { replay } from './game-replay.ts';

// The server consumes a real mutation before failing its acknowledgement.
// Retrying would deliver the same game event twice, even if the next call passed.
async function withControlServer(mode, roomId, run) {
  const writes = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers['x-e2e-control-token'], 'test-control');
    const path = new URL(request.url).pathname;
    if (path === '/android/session') {
      assert.equal(request.method, 'GET');
      response.end(JSON.stringify({ room: roomId ? { roomId } : null }));
      return;
    }
    assert.equal(request.method, 'POST');
    let body = '';
    for await (const chunk of request) body += chunk;
    writes.push({ path, payload: JSON.parse(body) });
    if (writes.length === 1 && mode === 'disconnect') request.socket.destroy();
    else if (writes.length === 1 && mode === 'invalid-json') response.end('{');
    else if (writes.length === 1 && mode === 'http-error') {
      response.statusCode = 500;
      response.end('{"error":"after publication"}');
    } else response.end('{"ok":true}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(new Mitmproxy(server.address().port, 'test-control'), writes);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

for (const game of ['texas', 'zhajinhua']) {
  const data = { stream: game, queue: [{ event: 'single-visible-action' }] };
  test(`${game} 回放成功只发送一次原始事件`, async () => {
    await withControlServer('success', 'current-room', async (proxy, writes) => {
      await replay(proxy, game, 'current-room', data);
      assert.deepEqual(writes, [{ path: `/${game}/replay`, payload: { roomId: 'current-room', data } }]);
    });
  });
  for (const mode of ['disconnect', 'invalid-json', 'http-error']) {
    test(`${game} 已发布后 ${mode} 不重发事件`, async () => {
      await withControlServer(mode, 'current-room', async (proxy, writes) => {
        await assert.rejects(replay(proxy, game, 'current-room', data));
        assert.equal(writes.length, 1, '即使重试能收到200，也必须保留首次未知发布结果');
      });
    });
  }
  test(`${game} 不允许未建房或其他房间收到回放`, async () => {
    for (const registeredRoom of [null, 'another-room']) {
      await withControlServer('success', registeredRoom, async (proxy, writes) => {
        await assert.rejects(replay(proxy, game, 'current-room', data), /本轮新建的私人房/);
        assert.equal(writes.length, 0);
      });
    }
  });
}
