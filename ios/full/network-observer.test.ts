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

/** 经真实 iOS 插件与本地上游验证多节点；只改进程上游，不更改系统网络。 */
test('iOS原生入口保留多节点真实健康、v12/v13列表与预检，业务夹具继续生效', async () => {
  const { createServer } = await import('node:http');
  const { visualNetworkRouter } = await import('./network-routes');
  const route = await visualNetworkRouter();
  const token = 'offline-ios-fixture-token';
  const nodes = ['64.kr-seoul.api.staging.laiwan.shafayouxi.com',
    '67.hk.api.staging.laiwan.shafayouxi.com', '68.kr.api.staging.laiwan.shafayouxi.com'];
  let upstreamRequests = 0;
  let fixtureRequests = 0;
  const upstream = createServer((incoming, response) => {
    upstreamRequests++;
    const url = new URL(incoming.url!, `http://${incoming.headers.host}`);
    const failed = url.searchParams.has('failed') || url.hostname === nodes[2];
    const status = incoming.method === 'OPTIONS' ? 204 : failed ? 503 : 200;
    response.writeHead(status, { 'Content-Type': 'application/json', 'X-Real-Upstream': 'yes',
      'Access-Control-Allow-Origin': 'https://app.test', 'Access-Control-Allow-Headers': 'authorization',
      'ETag': 'upstream-tag' });
    const candidates = url.searchParams.has('without64') ? nodes.slice(1) : nodes;
    response.end(incoming.method === 'OPTIONS' ? '' : JSON.stringify(url.pathname === '/node/v1/status'
      ? { server_load: failed ? 'unavailable' : 'normal',
        backend_delay: url.hostname === nodes[0] ? 1065 : 37, new_health: true }
      : { ok: !failed, extra: 42, result: { servers: url.pathname.includes('/v12/') ? candidates
        : Object.fromEntries(candidates.map((host, index) => [host, `192.0.2.${index + 1}`])) } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  const directory = await mkdtemp(path.join(tmpdir(), 'ios-upstream-test-'));
  const executable = path.join(directory, 'mitmdump');
  const previousExecutable = process.env.MITMDUMP_PATH;
  const realExecutable = previousExecutable || process.env.E2E_MITMDUMP_PATH
    || fileURLToPath(new URL('../../e2e/.venv/bin/mitmdump', import.meta.url));
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  await writeFile(executable, `#!/bin/sh\nexec ${quote(realExecutable)} --mode ${quote(`upstream:http://127.0.0.1:${upstreamAddress.port}`)} "$@"\n`, { mode: 0o700 });
  process.env.MITMDUMP_PATH = executable;
  const server = createServer(async (incoming, response) => {
    if (incoming.headers.authorization !== token) { response.writeHead(403).end(); return; }
    fixtureRequests++;
    let body = '';
    for await (const chunk of incoming) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(await route(JSON.parse(body).url)));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (const mode of [{ game: 'texas-holdem' }, { game: 'zhajinhua' }, { game: '', records: true }, { game: '' }]) {
      await withMitmproxy(async proxy => {
        const fetch = (host: string, apiPath: string, method = 'GET') => new Promise<{
          status: number; headers: import('node:http').IncomingHttpHeaders; body: any;
        }>((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port: new URL(proxy.server).port,
            path: `http://${host}${apiPath}`, method,
            headers: { Host: host, 'User-Agent': 'laiwan/2.0 CFNetwork iPhone iOS 18.5', 'X-Platform': 'ios',
              Origin: 'https://app.test', 'Access-Control-Request-Headers': 'authorization' } }, response => {
            let text = ''; response.on('data', chunk => { text += chunk; });
            response.once('error', reject);
            response.once('end', () => {
              try { resolve({ status: response.statusCode!, headers: response.headers, body: text ? JSON.parse(text) : null }); }
              catch (error) { reject(error); }
            });
          });
          req.once('error', reject); req.end();
        });
        const fixtureBefore = fixtureRequests;
        for (const host of ['api.shafayouxi.org', ...nodes]) {
          for (const version of [12, 13]) {
            for (const method of ['GET', 'POST', 'OPTIONS']) {
              for (const query of ['platform=ios', 'without64', 'failed']) {
                const result = await fetch(host, `/public/v${version}/metadata/servers?${query}`, method);
                const failed = query === 'failed' || host === nodes[2];
                assert.equal(result.status, method === 'OPTIONS' ? 204 : failed ? 503 : 200);
                assert.equal(result.headers['x-real-upstream'], 'yes');
                assert.equal(result.headers['access-control-allow-origin'], 'https://app.test');
                assert.equal(result.headers['etag'], 'upstream-tag');
                if (method === 'OPTIONS') assert.equal(result.headers['access-control-allow-headers'], 'authorization');
                else {
                  const candidates = query === 'without64' ? nodes.slice(1) : nodes;
                  assert.deepEqual(result.body, { ok: !failed, extra: 42, result: { servers: version === 12 ? candidates
                    : Object.fromEntries(candidates.map((node, index) => [node, `192.0.2.${index + 1}`])) } });
                }
              }
            }
          }
          for (const method of ['GET', 'OPTIONS']) {
            for (const query of ['', '?failed']) {
              const result = await fetch(host, `/node/v1/status${query}`, method);
              const failed = query === '?failed' || host === nodes[2];
              assert.equal(result.status, method === 'OPTIONS' ? 204 : failed ? 503 : 200);
              assert.equal(result.headers['x-real-upstream'], 'yes');
              if (method === 'GET') assert.deepEqual(result.body, { server_load: failed ? 'unavailable' : 'normal',
                backend_delay: host === nodes[0] ? 1065 : 37, new_health: true });
            }
          }
        }
        assert.equal(fixtureRequests, fixtureBefore, '选线请求不能进入 Node 业务夹具桥');
        const transport = await proxy.command<{ tlsFailures: unknown[]; httpEvents: {
          host: string; path: string; status: number; mocked: boolean; elapsedMs: number;
          source: string; backendDelay?: number; fixtureElapsedMs: number | null; candidateHosts?: string[];
        }[] }>('native/transport');
        assert.deepEqual(transport.tlsFailures, []);
        assert.ok(transport.httpEvents.some(item => JSON.stringify(item.candidateHosts) === JSON.stringify([...nodes].sort())));
        assert.ok(transport.httpEvents.some(item => JSON.stringify(item.candidateHosts) === JSON.stringify(nodes.slice(1).sort())));
        assert.ok(transport.httpEvents.some(item => item.host === nodes[0] && item.backendDelay === 1065));
        assert.ok(transport.httpEvents.some(item => item.host === nodes[1] && item.backendDelay === 37 && item.status === 200));
        assert.ok(transport.httpEvents.some(item => item.host === nodes[2] && item.status === 503));
        assert.ok(transport.httpEvents.every(item => !item.mocked && item.source === 'upstream'
          && item.elapsedMs >= 0 && item.fixtureElapsedMs === null));
        const before = upstreamRequests;
        for (const apiPath of ['/public/v10/profile/country?platform=ios', '/public/v1/hall_matching/available.json',
          '/public/v1/hall_matching/texas_holdem/halls', '/public/v1/hall_matching/zhajinhua/halls']) {
          const result = await fetch(nodes[1], apiPath);
          assert.equal(result.status, 200);
          assert.equal(result.body.ok, true);
          if (apiPath.includes('/country')) assert.equal(result.body.result.countryPhoneCode, '86');
        }
        assert.equal(upstreamRequests, before, '业务共享夹具继续生效');
        assert.equal(fixtureRequests - fixtureBefore, 4);
      }, { addonPath: fileURLToPath(new URL('./proxy-addon.py', import.meta.url)),
        environment: { ...process.env, IOS_FUNCTIONAL: 'false', IOS_GAME: mode.game,
          IOS_RECORDS: mode.records ? 'true' : 'false', IOS_MATCHING: 'false', IOS_SLOT: 'false',
          IOS_FIXTURE_TOKEN: token, IOS_FIXTURE_URL: `http://127.0.0.1:${address.port}/` } });
    }
  } finally {
    if (previousExecutable === undefined) delete process.env.MITMDUMP_PATH;
    else process.env.MITMDUMP_PATH = previousExecutable;
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())),
      new Promise<void>(resolve => upstream.close(() => resolve()))]);
    await rm(directory, { recursive: true, force: true });
  }
});
