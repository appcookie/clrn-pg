import { setTimeout as delay } from 'node:timers/promises';
import type { Mitmproxy } from '../../e2e/helpers/mitmproxy-client';

/** 仅在测试进程内存使用；禁止附加到报告或打印（登录响应可能含 token）。 */
export type CapturedResponse = {
  sequence: number; method: string; url: string; path: string; status: number;
  body: any; requestBody: any; session: string | null; mocked: boolean;
};
export type ResponseMatch = { method?: string; path: string | RegExp; after?: number;
  session?: string; timeoutMs?: number };
export type ObservedSession = { key: string; userId: string; username: string;
  deviceId: string; authorization: string; origin: string };
export type RoomCreationAttempt = { sequence: number; completed: boolean; status: number | null; ok: boolean | null;
  method: 'POST'; path: '/v3/pay_action/do'; requestAtUtc: string; completedAtUtc?: string;
  responseSource?: 'none' | 'fixture' | 'upstream'; failureCategory?: string; failureReason?: string | null;
  observationHook?: 'response' | 'error'; fixtureLookupFailed?: boolean;
  serverTcpEstablished?: boolean; serverTlsEstablished?: boolean; viaProxy?: boolean };

export class NetworkObserver {
  constructor(private readonly proxy: Mitmproxy) {}
  async mark(): Promise<number> {
    return (await this.proxy.command<{ sequence: number }>('native/observer/mark')).sequence;
  }
  async captured(match: ResponseMatch): Promise<CapturedResponse[]> {
    const { events } = await this.proxy.command<{ events: CapturedResponse[] }>('native/observer/events', { after: match.after || 0 });
    return events.filter(event => (!match.method || event.method === match.method.toUpperCase())
      && (!match.session || event.session === match.session)
      && (typeof match.path === 'string' ? event.path === match.path
        : new RegExp(match.path.source, match.path.flags.replace(/[gy]/g, '')).test(event.path)));
  }
  async waitForResponse(match: ResponseMatch, action?: () => Promise<unknown>): Promise<CapturedResponse> {
    const after = match.after ?? await this.mark();
    if (action) await action();
    const deadline = Date.now() + (match.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      const [response] = await this.captured({ ...match, after });
      if (response) return response;
      await delay(100);
    }
    throw new Error(`未收到预期原生 HTTP 响应：${match.method || '*'} ${String(match.path)}`);
  }
  async sessions(): Promise<ObservedSession[]> {
    return (await this.proxy.command<{ sessions: ObservedSession[] }>('native/observer/sessions')).sessions;
  }
  /** 只读取本轮建房请求的状态，不返回请求正文、响应正文或房间身份。 */
  async roomCreationAttempts(after: number): Promise<RoomCreationAttempt[]> {
    return (await this.proxy.command<{ attempts: RoomCreationAttempt[] }>('native/observer/room-creation',
      { after })).attempts;
  }
  async respond(rule: { method: string; path: string; status: number; body: unknown; session?: string; times?: number }): Promise<void> {
    await this.proxy.command('native/observer/respond', { ...rule, method: rule.method.toUpperCase() });
  }
  async clearRules(): Promise<void> { await this.proxy.command('native/observer/clear-rules', {}); }
  async clear(): Promise<void> { await this.proxy.command('native/observer/clear', {}); }
}
