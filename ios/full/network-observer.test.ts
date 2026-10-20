import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
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

/** iOS 客户端公共请求经过与真实任务相同的 Python -> Node 夹具桥，不依赖 Android 平台字段。 */
test('iOS游客启动请求可命中metadata、health、country和hall共享夹具', async () => {
  const { createServer } = await import('node:http');
  const { visualNetworkRouter } = await import('./network-routes');
  const route = await visualNetworkRouter();
  const token = 'offline-ios-fixture-token';
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
      for (const path of ['/public/v13/metadata/servers?platform=ios', '/node/v1/status',
        '/public/v10/profile/country?platform=ios', '/public/v1/hall_matching/available.json',
        '/public/v1/hall_matching/texas_holdem/halls', '/public/v1/hall_matching/zhajinhua/halls']) {
        const body = await new Promise<any>((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port: new URL(proxy.server).port,
            path: `http://64.kr-seoul.api.staging.laiwan.shafayouxi.com${path}`,
            headers: { Host: '64.kr-seoul.api.staging.laiwan.shafayouxi.com',
              'User-Agent': 'laiwan/2.0 CFNetwork iPhone iOS 18.5', 'X-Platform': 'ios' } }, response => {
            if (response.statusCode !== 200) { reject(new Error('iOS fixture did not match')); response.resume(); return; }
            let text = ''; response.on('data', chunk => { text += chunk; });
            response.once('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
          });
          req.once('error', reject); req.end();
        });
        if (path === '/node/v1/status') assert.equal(body.server_load, 'normal');
        else assert.equal(body.ok, true);
        if (path.startsWith('/public/v10/profile/country')) assert.equal(body.result.countryPhoneCode, '86');
      }
      const transport = await proxy.command<{ responses: { path: string; status: number; count: number }[];
        tlsFailures: unknown[] }>('native/transport');
      assert.ok(transport.responses.some(item => item.path === '/node/v1/status' && item.status === 200));
      assert.ok(transport.responses.some(item => item.path === '/public/v13/metadata/servers' && item.status === 200));
      assert.deepEqual(transport.tlsFailures, []);
    }, { addonPath: fileURLToPath(new URL('./proxy-addon.py', import.meta.url)),
      environment: { ...process.env, IOS_FUNCTIONAL: 'false', IOS_FIXTURE_TOKEN: token,
        IOS_FIXTURE_URL: `http://127.0.0.1:${address.port}/` } });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
