import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMitmproxy } from '../../e2e/helpers/mitmproxy-session';
import { NetworkObserver } from './network-observer';

/** 只启动回环mitmdump，不配置主机或模拟器网络。 */
test('真实mitmdump控制协议支持精确覆写、计数、鉴权和内存观测', async () => {
  await withMitmproxy(async proxy => {
    const observer = new NetworkObserver(proxy);
    const after = await observer.mark();
    await observer.respond({ method: 'GET', path: '/ios-network-integration', status: 503, body: { ok: false, error: 'injected' } });
    const observed = await observer.waitForResponse({ method: 'GET', path: '/ios-network-integration', after }, async () => {
      await new Promise<void>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: new URL(proxy.server).port,
          path: 'http://api.shafayouxi.org/ios-network-integration', headers: { Host: 'api.shafayouxi.org' } }, response => {
          assert.equal(response.statusCode, 503);
          response.resume(); response.once('end', resolve);
        });
        req.once('error', reject); req.end();
      });
    });
    assert.equal(observed.status, 503);
    assert.equal(observed.mocked, true);
    assert.deepEqual(observed.body, { ok: false, error: 'injected' });
    assert.equal((await observer.captured({ path: /ios-network-integration/g, after })).length, 1);
    await observer.clear();
    assert.deepEqual(await observer.captured({ path: '/ios-network-integration', after }), []);
    assert.deepEqual(await observer.sessions(), []);
  }, { addonPath: fileURLToPath(new URL('./proxy-addon.py', import.meta.url)),
    environment: { ...process.env, IOS_FUNCTIONAL: 'true' } });
});

test('代理连接被拒绝时客户端收到502，原生观测保留无上游响应的0且不重放POST', async () => {
  const { createServer } = await import('node:net');
  const unavailable = createServer();
  await new Promise<void>(resolve => unavailable.listen(0, '127.0.0.1', resolve));
  const address = unavailable.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => unavailable.close(() => resolve()));
  const directory = await mkdtemp(path.join(tmpdir(), 'ios-connection-error-test-'));
  const previousExecutable = process.env.MITMDUMP_PATH;
  const realExecutable = previousExecutable || process.env.E2E_MITMDUMP_PATH
    || fileURLToPath(new URL('../../e2e/.venv/bin/mitmdump', import.meta.url));
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const executable = path.join(directory, 'mitmdump');
  await writeFile(executable, `#!/bin/sh\nexec ${quote(realExecutable)} --mode ${quote(`upstream:http://127.0.0.1:${address.port}`)} "$@"\n`, { mode: 0o700 });
  process.env.MITMDUMP_PATH = executable;
  try {
    await withMitmproxy(async proxy => {
      const observer = new NetworkObserver(proxy);
      const after = await observer.mark();
      await new Promise<void>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: new URL(proxy.server).port, method: 'POST',
          path: 'http://api.shafayouxi.org/v3/pay_action/do?token=private-query',
          headers: { Host: 'api.shafayouxi.org', Authorization: 'Bearer private-token' } }, response => {
          try { assert.equal(response.statusCode, 502); }
          catch (error) { response.resume(); reject(error); return; }
          response.resume(); response.once('end', resolve);
        });
        req.once('error', reject); req.end('{"secret":"private-body"}');
      });
      const attempts = await observer.roomCreationAttempts(after);
      assert.equal(attempts.length, 1, '连接失败不能自动重复建房 POST');
      assert.deepEqual([attempts[0].status, attempts[0].ok, attempts[0].responseSource, attempts[0].failureCategory],
        [0, false, 'none', 'proxy-connection']);
      const transport = await proxy.command<{ httpEvents: { sequence: number; status: number; observationHook: string }[] }>('native/transport');
      assert.equal(transport.httpEvents.length, 1);
      assert.equal(transport.httpEvents[0].sequence, attempts[0].sequence);
      assert.equal(transport.httpEvents[0].status, 0);
      assert.equal(transport.httpEvents[0].observationHook, 'error');
      assert.ok(!JSON.stringify([transport, attempts]).includes('private-'));
    }, { addonPath: fileURLToPath(new URL('./proxy-addon.py', import.meta.url)),
      environment: { ...process.env, IOS_FUNCTIONAL: 'true' } });
  } finally {
    if (previousExecutable === undefined) delete process.env.MITMDUMP_PATH;
    else process.env.MITMDUMP_PATH = previousExecutable;
    await rm(directory, { recursive: true, force: true });
  }
});

/** iOS 客户端公共请求经过与真实任务相同的 Python -> Node 夹具桥，不依赖 Android 平台字段。 */
test('iOS原生桥透传本地上游健康与metadata，业务共享夹具继续生效', async () => {
  const { createServer } = await import('node:http');
  const { visualNetworkRouter } = await import('./network-routes');
  const route = await visualNetworkRouter();
  const token = 'offline-ios-fixture-token';
  let upstreamRequests = 0;
  const creationRequests: { method: string; url: string; body: string; authorization: string | undefined }[] = [];
  const upstream = createServer(async (request, response) => {
    upstreamRequests++;
    const url = new URL(request.url!, 'http://local-upstream');
    const failed = url.searchParams.has('failed');
    if (url.pathname === '/v3/pay_action/do') {
      let body = '';
      for await (const chunk of request) body += chunk;
      creationRequests.push({ method: request.method!, url: request.url!, body,
        authorization: request.headers.authorization });
      response.writeHead(failed ? 502 : 200, { 'Content-Type': 'application/json', 'X-Real-Upstream': 'yes' });
      response.end(failed ? '{"ok":false,"error":"private-upstream-error"}' : '{"ok":true,"result":{}}');
      return;
    }
    response.writeHead(failed ? 503 : 200, { 'Content-Type': 'application/json', 'X-Real-Upstream': 'yes' });
    response.end(JSON.stringify(url.pathname === '/node/v1/status'
      ? { server_load: failed ? 'unavailable' : 'normal', backend_delay: 37 }
      : { ok: true, result: { servers: { '64.kr-seoul.api.staging.laiwan.shafayouxi.com': '192.0.2.1' } } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  // Start the actual listener in upstream mode from its first instruction.
  // A test-only executable wrapper leaves production process arguments intact.
  const directory = await mkdtemp(path.join(tmpdir(), 'ios-upstream-test-'));
  const executable = path.join(directory, 'mitmdump');
  const previousExecutable = process.env.MITMDUMP_PATH;
  const realExecutable = previousExecutable || process.env.E2E_MITMDUMP_PATH
    || fileURLToPath(new URL('../../e2e/.venv/bin/mitmdump', import.meta.url));
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await writeFile(executable, `#!/bin/sh\nexec ${quote(realExecutable)} --mode ${quote(`upstream:http://127.0.0.1:${upstreamAddress.port}`)} "$@"\n`, { mode: 0o700 });
  process.env.MITMDUMP_PATH = executable;
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== token) { response.writeHead(403).end(); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(await route(JSON.parse(body).url)));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await withMitmproxy(async proxy => {
      for (const path of ['/public/v13/metadata/servers?platform=ios', '/public/v13/metadata/servers?failed',
        '/node/v1/status', '/node/v1/status?failed',
        '/v3/pay_action/do?token=private-query', '/v3/pay_action/do?failed&token=private-query',
        '/public/v10/profile/country?platform=ios', '/public/v1/hall_matching/available.json',
        '/public/v1/hall_matching/texas_holdem/halls', '/public/v1/hall_matching/zhajinhua/halls']) {
        const creation = path.startsWith('/v3/pay_action/do');
        const body = await new Promise<any>((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port: new URL(proxy.server).port,
            path: `http://64.kr-seoul.api.staging.laiwan.shafayouxi.com${path}`,
            method: creation ? 'POST' : 'GET',
            headers: { Host: '64.kr-seoul.api.staging.laiwan.shafayouxi.com',
              ...(creation ? { Authorization: 'Bearer private-token', 'Content-Type': 'application/json' } : {}),
              'User-Agent': 'laiwan/2.0 CFNetwork iPhone iOS 18.5', 'X-Platform': 'ios' } }, response => {
            try {
              assert.equal(response.statusCode, path.includes('failed') ? creation ? 502 : 503 : 200);
              if (creation || path.includes('/metadata/') || path.startsWith('/node/')) assert.equal(response.headers['x-real-upstream'], 'yes');
            } catch (error) { response.resume(); reject(error); return; }
            let text = ''; response.on('data', chunk => { text += chunk; });
            response.once('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
          });
          req.once('error', reject); req.end(creation ? '{"secret":"private-body"}' : undefined);
        });
        if (path.startsWith('/node/v1/status')) {
          assert.equal(body.server_load, path.includes('failed') ? 'unavailable' : 'normal');
          assert.equal(body.backend_delay, 37);
        } else assert.equal(body.ok, !(creation && path.includes('failed')));
        if (path.includes('/metadata/')) assert.equal(body.result.servers['64.kr-seoul.api.staging.laiwan.shafayouxi.com'], '192.0.2.1');
        if (path.startsWith('/public/v10/profile/country')) assert.equal(body.result.countryPhoneCode, '86');
      }
      const transport = await proxy.command<{ responses: { path: string; status: number; count: number }[];
        tlsFailures: unknown[]; httpEvents: { path: string; status: number; mocked: boolean; elapsedMs: number; source: string }[] }>('native/transport');
      assert.ok(transport.responses.some(item => item.path === '/node/v1/status' && item.status === 200));
      assert.ok(transport.responses.some(item => item.path === '/public/v13/metadata/servers' && item.status === 200));
      assert.deepEqual(transport.tlsFailures, []);
      assert.equal(upstreamRequests, 6, '健康、metadata 和真实建房到达本地上游，其他业务夹具继续生效');
      assert.deepEqual(creationRequests, [false, true].map(failed => ({ method: 'POST',
        url: `http://64.kr-seoul.api.staging.laiwan.shafayouxi.com/v3/pay_action/do?${failed ? 'failed&' : ''}token=private-query`,
        body: '{"secret":"private-body"}', authorization: 'Bearer private-token' })));
      const attempts = await new NetworkObserver(proxy).roomCreationAttempts(0);
      assert.deepEqual(attempts.map(item => [item.status, item.ok, item.responseSource, item.failureCategory]),
        [[200, true, 'upstream', 'none'], [502, false, 'upstream', 'upstream-http']]);
      assert.ok(!JSON.stringify([transport, attempts]).includes('private-'));
      assert.ok(transport.responses.some(item => item.path === '/node/v1/status' && item.status === 503));
      assert.ok(transport.httpEvents.every(item => !item.mocked && item.source === 'upstream' && item.elapsedMs >= 0));
    }, { addonPath: fileURLToPath(new URL('./proxy-addon.py', import.meta.url)),
      environment: { ...process.env, IOS_FUNCTIONAL: 'false', IOS_GAME: 'zhajinhua', IOS_FIXTURE_TOKEN: token,
        IOS_FIXTURE_URL: `http://127.0.0.1:${address.port}/` } });
  } finally {
    if (previousExecutable === undefined) delete process.env.MITMDUMP_PATH;
    else process.env.MITMDUMP_PATH = previousExecutable;
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => upstream.close(() => resolve()))]);
    await rm(directory, { recursive: true, force: true });
  }
});
