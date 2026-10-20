import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Mitmproxy } from './mitmproxy-client';
import { startMitmdump } from './mitmproxy-process';

/** 申请本机临时监听端口并关闭探测服务，返回可用于代理的端口号。 */
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配 mitmproxy 端口');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

/**
 * 测试结束或失败时先停止代理，再删除临时证书。
 * @param task - 在已准备好的上下文或代理上执行的异步任务。
 * @param options - 专用插件、进程环境和启动后的证书准备步骤；默认保持 Web 代理行为。
 */
export async function withMitmproxy<T>(task: (proxy: Mitmproxy) => Promise<T>,
  options: { addonPath?: string; environment?: NodeJS.ProcessEnv;
    prepare?: (directory: string, proxy: Mitmproxy) => Promise<void>;
    cleanup?: () => Promise<void> } = {}): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), 'test-mitmproxy-'));
  const token = randomBytes(32).toString('hex');
  try {
    const port = await unusedPort();
    const proxy = new Mitmproxy(port, token);
    const proxyProcess = startMitmdump(port, directory, token, options.addonPath, options.environment);
    try {
      await proxyProcess.waitUntilReady(() => proxy.status());
      await options.prepare?.(directory, proxy);
      return await task(proxy);
    } finally {
      try { await options.cleanup?.(); } finally { await proxyProcess.stop(); }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
