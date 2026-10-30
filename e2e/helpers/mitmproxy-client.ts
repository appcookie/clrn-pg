import { request } from 'node:http';

const CONTROL_HOST = 'test-mitmproxy.invalid';
const REPLAY_ERROR_CODES = new Set(['invalid_replay', 'room_mismatch', 'room_not_created',
  'room_not_subscribed', 'unknown_command', 'invalid_readiness', 'invalid_command']);

/**
 * Only fixed diagnostics from the authenticated proxy may reach CI logs.
 * @param data - Untrusted HTTP error body, never logged verbatim.
 */
function controlFailureDiagnostics(data: string): string {
  try {
    const value = JSON.parse(data);
    if (!value || !REPLAY_ERROR_CODES.has(value.errorCode)) return '';
    const safe: Record<string, string | number> = { errorCode: value.errorCode };
    if (typeof value.sampledAtUtc === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|\+00:00)$/.test(value.sampledAtUtc)) {
      safe.sampledAtUtc = value.sampledAtUtc;
    }
    for (const key of ['liveConnections', 'confirmedSubscriptions', 'pendingSubscriptions']) {
      if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 10_000) safe[key] = value[key];
    }
    return ` ${JSON.stringify(safe)}`;
  } catch { return ''; }
}

export type FaultScenario = 'hall-timeout' | 'login-failure' | 'club-failure';
type ProxyScenario = FaultScenario | 'visual-stable';
export type ProxyStatus = {
  scenario: ProxyScenario | null;
  interceptedRequests: number;
  proxiedRequests: number;
  stabilizedRequests: number;
};

/** 通过代理内的认证接口控制插件，不把控制 token 传入浏览器。 */
export class Mitmproxy {
  readonly server: string;

  /**
   * 绑定本轮代理连接及认证配置。
   * @param port - 本机代理监听端口。
   * @param token - 仅用于测试接口或代理控制接口的认证凭据。
   */
  constructor(private readonly port: number, private readonly token: string) {
    this.server = `http://127.0.0.1:${port}`;
  }

  /**
   * 向本机代理的认证控制接口发送命令，解析响应并传播请求失败。
   * @param endpoint - 代理控制接口的相对路径。
   * @param payload - 可选命令正文；缺失时发送 GET 请求。
   * @param timeoutMs - 控制请求的超时毫秒数。
   */
  command<T = ProxyStatus>(endpoint: string, payload?: unknown, timeoutMs = 5_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const req = request({
        hostname: '127.0.0.1',
        port: this.port,
        path: `http://${CONTROL_HOST}/${endpoint}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Host: CONTROL_HOST,
          'X-E2E-Control-Token': this.token,
          'Content-Type': 'application/json',
        },
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`mitmproxy 控制请求失败：HTTP ${response.statusCode}${controlFailureDiagnostics(data)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('mitmproxy 控制请求超时')));
      req.end(body);
    });
  }

  /** 读取当前代理场景、拦截统计及回放状态。 */
  status(): Promise<ProxyStatus> {
    return this.command('status');
  }

  /**
   * 启用指定弱网故障场景，使后续业务请求由代理注入故障。
   * @param scenario - 本次执行的视觉配置或代理故障场景。
   */
  inject(scenario: FaultScenario): Promise<ProxyStatus> {
    return this.command('scenario', { scenario });
  }

  /** 启用视觉业务夹具；节点列表、健康检查与预检仍访问真实上游。 */
  stabilizeVisualNetwork(): Promise<ProxyStatus> {
    return this.command('scenario', { scenario: 'visual-stable' });
  }

  /** 清除故障注入配置，恢复代理的默认转发行为。 */
  clear(): Promise<ProxyStatus> {
    return this.command('scenario', { scenario: null });
  }
}
