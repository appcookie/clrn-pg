// 只封装 XCUITest 所需的 W3C WebDriver 命令，所有元素通过原生可访问性标识定位。
import { setTimeout as delay } from 'node:timers/promises';

const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

export class WebDriver {
  constructor(server = 'http://127.0.0.1:4723') {
    this.server = server;
    this.session = undefined;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.server}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.value?.error) {
      const error = new Error(payload.value?.message || `WebDriver ${method} ${path}: HTTP ${response.status}`);
      error.code = payload.value?.error || String(response.status);
      throw error;
    }
    return payload.value;
  }

  path(suffix = '') {
    if (!this.session) throw new Error('XCUITest 会话尚未建立。');
    return `/session/${this.session}${suffix}`;
  }

  async start(capabilities) {
    const result = await this.request('POST', '/session', { capabilities: { alwaysMatch: capabilities } });
    this.session = result.sessionId;
    if (!this.session) throw new Error('XCUITest 没有返回会话 ID。');
  }

  async find(identifier, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let lastError;
    do {
      try {
        const element = await this.request('POST', this.path('/element'), { using: 'accessibility id', value: identifier });
        if (!element?.[elementKey]) throw new Error(`缺少原生控件 ID：${identifier}`);
        return element[elementKey];
      } catch (error) {
        if (error.code !== 'no such element') throw error;
        lastError = error;
        await delay(400);
      }
    } while (Date.now() < deadline);
    throw new Error(`等待原生控件 ${identifier} 超时：${lastError?.message}`);
  }

  async tap(identifier) {
    const element = await this.find(identifier);
    await this.request('POST', this.path(`/element/${element}/click`), {});
  }

  async fill(identifier, value) {
    const element = await this.find(identifier);
    await this.request('POST', this.path(`/element/${element}/clear`), {});
    await this.request('POST', this.path(`/element/${element}/value`), { text: value });
  }

  async screenshot() {
    return Buffer.from(await this.request('GET', this.path('/screenshot')), 'base64');
  }

  async source() {
    return this.request('GET', this.path('/source'));
  }

  async close() {
    if (this.session) {
      try { await this.request('DELETE', this.path(), undefined); }
      finally { this.session = undefined; }
    }
  }
}
