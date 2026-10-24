import type { BrowserContext, Route } from '@playwright/test';
import { mockVisualNetworkDependencies } from '../../visual/src/support/networkMocks';

type Matcher = string | RegExp | ((url: URL) => boolean);
type Handler = (route: Route) => unknown;
export type MockResponse = { status: number; contentType?: string; body?: string; aborted?: boolean };

/**
 * 把现有 Web 网络夹具注册为传输层无关的响应查询器，原生代理直接复用相同响应。
 * 原生端没有 localStorage；国家区号由共用的 country 接口响应提供。
 * @param options - 保留真实私人房接口，或将战绩交由共享代理。
 */
export async function visualNetworkRouter(options: { realPrivateRoom?: boolean; recordFixtures?: boolean } = {}): Promise<(url: string) => Promise<MockResponse | null>> {
  const routes: { matcher: Matcher; handler: Handler }[] = [];
  await mockVisualNetworkDependencies({
    /**
     * 保留 Web 路由注册顺序。
     * @param matcher - URL 匹配条件。
     * @param handler - 共用响应处理器。
     */
    route: async (matcher: Matcher, handler: Handler) => { routes.push({ matcher, handler }); },
    /** 原生端通过 country 接口设置国家区号，无浏览器存储初始化。 */
    addInitScript: async () => {},
  // The native bridge already uses VisualNetwork in mitmproxy. Registering the
  // browser-only status/metadata mocks here would replace real upstream health
  // with a fabricated healthy node and its IP with 127.0.0.1.
  } as unknown as BrowserContext, { ...options, useMitmproxy: true });
  return async (url: string) => {
    const selected = [...routes].reverse().find(({ matcher }) => {
      if (typeof matcher === 'function') return matcher(new URL(url));
      if (matcher instanceof RegExp) return matcher.test(url);
      throw new Error(`尚未适配原生代理的 URL 通配符：${matcher}`);
    });
    if (!selected) return null;
    let response: MockResponse | undefined;
    await selected.handler({
      /** 返回当前请求的最小 URL 接口。 */
      request: () => ({ /** 返回实际请求 URL。 */ url: () => url }),
      /**
       * 保存共享夹具返回的响应。
       * @param options - 响应正文、状态与内容类型。
       */
      fulfill: async (options: MockResponse) => { response = options; },
      /** 保留 Web 对第三方流量的中断行为。 */
      abort: async () => { response = { status: 503, aborted: true }; },
    } as unknown as Route);
    if (!response) throw new Error(`网络夹具没有明确返回响应：${new URL(url).pathname}`);
    return response;
  };
}
