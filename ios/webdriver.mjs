// 只封装 XCUITest 所需的 W3C WebDriver 命令，所有元素通过原生可访问性标识定位。
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

export class WebDriver {
  constructor(server = 'http://127.0.0.1:4723') {
    this.server = server;
    this.session = undefined;
  }

  async request(method, path, body, timeout = 180_000) {
    // fetch/Undici 的独立 300 秒 headersTimeout 会先于首次 WDA 编译预算触发。
    // 直接使用 Node HTTP，让一个明确的 deadline 覆盖响应头和响应体。
    const url = new URL(`${this.server}${path}`);
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    const { status, payload } = await new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method, headers: { 'Content-Type': 'application/json', ...(bytes === undefined ? {} : { 'Content-Length': Buffer.byteLength(bytes) }) },
        signal: AbortSignal.timeout(timeout),
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          try { resolve({ status: response.statusCode, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.end(bytes);
    });
    if (status < 200 || status >= 300 || payload.value?.error) {
      const error = new Error(payload.value?.message || `WebDriver ${method} ${path}: HTTP ${status}`);
      error.code = payload.value?.error || String(status);
      throw error;
    }
    return payload.value;
  }

  path(suffix = '') {
    if (!this.session) throw new Error('XCUITest 会话尚未建立。');
    return `/session/${this.session}${suffix}`;
  }

  async start(capabilities) {
    const result = await this.request('POST', '/session', { capabilities: { alwaysMatch: capabilities } }, 1_200_000);
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
    for (const character of value) {
      await this.request('POST', this.path(`/element/${element}/value`), { text: character });
      await delay(150);
    }
    const actual = await this.request('GET', this.path(`/element/${element}/attribute/value`));
    if (actual !== value) throw new Error(`原生输入未完整写入：${identifier}`);
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
