import { fileURLToPath } from 'node:url';
import { expect as baseExpect, test as base } from '@playwright/test';
import path from 'node:path';
import type { Mitmproxy, ProxyStatus } from '../../../e2e/helpers/mitmproxy-client';
import { withMitmproxy } from '../../../e2e/helpers/mitmproxy-session';

export type RecordMode = 'empty' | 'list' | 'no-hands' | 'paged' | 'list-error' | 'detail-error' | 'delete-error';
export type RecordStatus = ProxyStatus & {
  recordRequests: Record<string, number>; faultRequests: Record<string, number>; deleted: string[];
};

/** 封装战绩专用代理的固定数据、分页和错误场景控制。 */
export class RecordProxy {
  /**
   * 绑定本轮代理连接及认证配置。
   * @param proxy - 本轮独占的代理控制对象。
   */
  constructor(private readonly proxy: Mitmproxy) {}
  /** 读取当前专用代理的本机访问地址。 */
  get server(): string { return this.proxy.server; }
  /**
   * 向本机代理的认证控制接口发送命令，解析响应并传播请求失败。
   * @param endpoint - 代理控制接口的相对路径。
   * @param payload - 可选命令正文；缺失时发送 GET 请求。
   */
  private command(endpoint: string, payload?: unknown): Promise<RecordStatus> {
    return this.proxy.command(endpoint, payload, 30_000);
  }
  /**
   * 配置战绩账号、页面版本与响应模式，可暂缓响应以截取加载状态。
   * @param userId - 当前账号的用户 ID。
   * @param version - 战绩页面版本：legacy 或 v2。
   * @param mode - 固定数据、加载或错误响应模式。
   * @param hold - 是否暂缓接口响应以截取加载状态。
   */
  configure(userId: string, version: 'legacy' | 'v2', mode: RecordMode, hold = false): Promise<RecordStatus> {
    return this.command('records/configure', { userId, version, mode, hold });
  }
  /**
   * 切换战绩响应模式并设置是否暂缓返回。
   * @param mode - 固定数据、加载或错误响应模式。
   * @param hold - 是否暂缓接口响应以截取加载状态。
   */
  mode(mode: RecordMode, hold = false): Promise<RecordStatus> {
    return this.command('records/mode', { mode, hold });
  }
  /** 释放代理暂缓的响应，让测试继续进入完成状态。 */
  release(): Promise<RecordStatus> { return this.command('records/release', {}); }
  /** 读取当前代理场景、拦截统计及回放状态。 */
  status(): Promise<RecordStatus> { return this.command('status'); }
}

export const test = base.extend<{ recordProxy: RecordProxy }>({
  /**
   * 启动战绩专用代理并启用固定网络场景，案例结束后清理资源。
   * @param fixtures - Playwright 注入的依赖，提供当前页面、上下文或已有代理。
   * @param use - 将准备好的 fixture 交给案例使用的回调。
   */
  recordProxy: async ({}, use) => {
    await withMitmproxy(async proxy => {
      await proxy.stabilizeVisualNetwork();
      await use(new RecordProxy(proxy));
    }, { addonPath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mitmproxy/addon.py') });
  },
});
export const expect = baseExpect.configure({ timeout: 90_000 });
