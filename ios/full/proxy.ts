import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../e2e/helpers/mitmproxy-session';
import { visualNetworkRouter } from './network-routes';
import { assertHostedRunner, configureSystemProxy, restoreSystemProxy } from './system-proxy.mjs';

function requireSimulator(): string {
  const udid = process.env.IOS_SIMULATOR_UDID || '';
  if (!/^[0-9a-f-]{36}$/i.test(udid)) throw new Error('必须指定专用 IOS_SIMULATOR_UDID');
  const list = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { encoding: 'utf8' }));
  const devices = Object.values(list.devices).flat() as { udid: string; isAvailable: boolean }[];
  if (!devices.some(device => device.udid === udid && device.isAvailable)) {
    throw new Error('指定 iOS Simulator 不存在或不可用');
  }
  return udid;
}

/**
 * 复用 Web 网络夹具和代理生命周期；真实认证与未声明的接口仍访问 staging。
 * @param task - 在已准备的模拟器网络环境内运行测试。
 * @param records - 战绩开关或要复用的 Web 玩法代理。
 * @param matching - 隔离大厅匹配队列，只返回等待状态。
 * @param slot - 隔离本轮账号的老虎机旋转和奖励。
 * @param skeleton - 暂缓俱乐部详情响应，保留真实列表占位动画。
 * @param invitable - 在私人房详情夹具中显示等待中的邀请入口。
 */
export async function withIosProxy<T>(task: (proxy: Mitmproxy) => Promise<T>,
  records: boolean | 'texas-holdem' | 'zhajinhua' = false, matching = false, slot = false,
  skeleton = false, invitable = false, options: { visual?: boolean } = {}): Promise<T> {
  assertHostedRunner();
  requireSimulator();
  const previousCa = process.env.IOS_PROXY_CA_CERT;
  const route = await visualNetworkRouter({ realPrivateRoom: typeof records === 'string', recordFixtures: records === true });
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== token) { response.writeHead(403).end(); return; }
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { url } = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(await route(url)));
    } catch {
      response.writeHead(500).end('Invalid fixture request');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('夹具服务启动失败。');

  const signalHandlers = (['SIGINT', 'SIGTERM'] as const).map(signal => {
    const handler = () => {
      try { restoreSystemProxy(); } finally { process.exit(signal === 'SIGINT' ? 130 : 143); }
    };
    process.once(signal, handler);
    return [signal, handler] as const;
  });

  try {
    return await withMitmproxy(async proxy => {
      try { return await task(proxy); }
      catch (error) {
        // 该专用接口只含初始化端点的 host/path/status 计数和 TLS 失败计数。
        // 不要改为输出 observer/session 或 mitm 原始日志，其中可能含登录凭据。
        try { console.error('[iOS proxy transport]', JSON.stringify(await proxy.command('native/transport'))); }
        catch { console.error('[iOS proxy transport] diagnostics unavailable'); }
        throw error;
      }
    }, {
      addonPath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'proxy-addon.py'),
      environment: { ...process.env, IOS_FUNCTIONAL: String(options.visual === false), IOS_RECORDS: String(records === true),
        IOS_GAME: typeof records === 'string' ? records : '', IOS_MATCHING: String(matching),
        IOS_SLOT: String(slot), IOS_SKELETON: String(skeleton), IOS_INVITABLE: String(invitable),
        IOS_FIXTURE_TOKEN: token,
        IOS_FIXTURE_URL: `http://127.0.0.1:${address.port}/` },
      /**
       * 配置 runner 代理并提供临时 CA，由 XCUITest 在 fullReset 后安装。
       * @param directory - 代理临时目录。
       * @param proxy - 本轮代理连接。
       */
      prepare: async (directory, proxy) => {
        configureSystemProxy(proxy.server);
        process.env.IOS_PROXY_CA_CERT = path.join(directory, 'mitmproxy-ca-cert.pem');
      },
      cleanup: async () => {
        restoreSystemProxy();
      },
    });
  } finally {
    if (previousCa === undefined) delete process.env.IOS_PROXY_CA_CERT;
    else process.env.IOS_PROXY_CA_CERT = previousCa;
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

/** 历史原生测试编排的兼容导出；始终使用 iOS Simulator。 */
export const withAndroidProxy = withIosProxy;
