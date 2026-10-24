import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Mitmproxy } from '../../e2e/helpers/mitmproxy-client.ts';
import { replay } from './game-replay.ts';

// The server consumes a real mutation before failing its acknowledgement.
// Retrying would deliver the same game event twice, even if the next call passed.
async function withControlServer(mode, roomId, run) {
  const writes = [];
  let readinessReads = 0;
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
    if (path.endsWith('/replay-ready')) {
      readinessReads++;
      if (mode === 'readiness-http-error') { response.statusCode = 400; response.end('{}'); return; }
      const ready = mode !== 'pending-once' || readinessReads > 1;
      response.end(JSON.stringify({ ready, liveConnections: 1, confirmedSubscriptions: ready ? 1 : 0,
        pendingSubscriptions: ready ? 0 : 1 }));
      return;
    }
    writes.push({ path, payload: JSON.parse(body) });
    if (mode === 'diagnostics') {
      response.statusCode = 400;
      response.end(JSON.stringify({ errorCode: 'room_not_subscribed', sampledAtUtc: '2026-10-21T08:11:30.000+00:00',
        confirmedSubscriptions: 0, liveConnections: 1, pendingSubscriptions: 1,
        error: 'secret-token', roomId: 'private-room', data: { token: 'secret-token' } }));
    } else if (mode === 'untrusted-diagnostics') {
      response.statusCode = 400;
      response.end(JSON.stringify({ errorCode: 'secret-token', sampledAtUtc: 'secret-token',
        confirmedSubscriptions: 'secret-token' }));
    } else if (writes.length === 1 && mode === 'disconnect') request.socket.destroy();
    else if (writes.length === 1 && mode === 'invalid-json') response.end('{');
    else if (writes.length === 1 && ['http-error', 'http-400'].includes(mode)) {
      response.statusCode = mode === 'http-400' ? 400 : 500;
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
  for (const mode of ['disconnect', 'invalid-json', 'http-error', 'http-400']) {
    test(`${game} 已发布后 ${mode} 不重发事件`, async () => {
      await withControlServer(mode, 'current-room', async (proxy, writes) => {
        await assert.rejects(replay(proxy, game, 'current-room', data));
        assert.equal(writes.length, 1, '即使重试能收到200，也必须保留首次未知发布结果');
      });
    });
  }
  test(`${game} 仅等待未发送前的订阅确认，不重发任何动作`, async () => {
    await withControlServer('pending-once', 'current-room', async (proxy, writes) => {
      await replay(proxy, game, 'current-room', data);
      assert.equal(writes.length, 1);
    });
    await withControlServer('readiness-http-error', 'current-room', async (proxy, writes) => {
      await assert.rejects(replay(proxy, game, 'current-room', data), /HTTP 400/);
      assert.equal(writes.length, 0);
    });
  });
  test(`${game} 不允许未建房或其他房间收到回放`, async () => {
    for (const registeredRoom of [null, 'another-room']) {
      await withControlServer('success', registeredRoom, async (proxy, writes) => {
        await assert.rejects(replay(proxy, game, 'current-room', data), /本轮新建的私人房/);
        assert.equal(writes.length, 0);
      });
    }
  });
}


test('控制失败仅记录固定错误码、UTC及安全计数，不记录请求或错误原文', async () => {
  await withControlServer('diagnostics', 'current-room', async (proxy, writes) => {
    await assert.rejects(proxy.command('texas/replay', {}), error => {
      assert.match(error.message, /room_not_subscribed/);
      assert.match(error.message, /2026-10-21T08:11:30.000\+00:00/);
      assert.match(error.message, /"confirmedSubscriptions":0/);
      assert.doesNotMatch(error.message, /secret-token|private-room/);
      return true;
    });
    assert.equal(writes.length, 1);
  });
  await withControlServer('untrusted-diagnostics', 'current-room', async proxy => {
    await assert.rejects(proxy.command('texas/replay', {}), error => {
      assert.equal(error.message, 'mitmproxy 控制请求失败：HTTP 400');
      return true;
    });
  });
});

test('订阅准备超时时不能发送事件', async t => {
  const writes = [];
  let ticks = 0;
  t.mock.method(Date, 'now', () => (++ticks === 1 ? 0 : 30_001));
  const proxy = {
    command: async (path, payload) => {
      if (path === 'android/session') return { room: { roomId: 'current-room' } };
      if (path === 'texas/replay-ready') return { ready: false, confirmedSubscriptions: 0,
        liveConnections: 1, pendingSubscriptions: 1 };
      writes.push({ path, payload });
    },
  };
  await assert.rejects(replay(proxy, 'texas', 'current-room', {}), /等待本轮房间真实订阅超时/);
  assert.equal(writes.length, 0);
});


test('伪造或不一致的订阅就绪状态不能发送事件', async () => {
  for (const state of [
    { ready: true, confirmedSubscriptions: 0, liveConnections: 1, pendingSubscriptions: 1 },
    { ready: true, confirmedSubscriptions: 1, liveConnections: 0, pendingSubscriptions: 0 },
    { ready: true, confirmedSubscriptions: '1', liveConnections: 1, pendingSubscriptions: 0 },
  ]) {
    let writes = 0;
    const proxy = { command: async path => {
      if (path === 'android/session') return { room: { roomId: 'current-room' } };
      if (path === 'texas/replay-ready') return state;
      writes++;
    } };
    await assert.rejects(replay(proxy, 'texas', 'current-room', {}));
    assert.equal(writes, 0);
  }
});
