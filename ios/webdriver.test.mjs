// 通过本地 W3C 端点验证驱动请求的协议形状和失败传播。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebDriver } from './webdriver.mjs';

test('WebDriver 使用原生 accessibility id 并能保存截图', async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls.push({ method: request.method, url: request.url, body: body && JSON.parse(body) });
    let value = null;
    if (request.url === '/session') value = { sessionId: 'test-session' };
    else if (request.url.endsWith('/element')) value = { 'element-6066-11e4-a52e-4f735466cecf': 'element-1' };
    else if (request.url.endsWith('/screenshot')) value = Buffer.from('PNG').toString('base64');
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ value }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const driver = new WebDriver(`http://127.0.0.1:${server.address().port}`);
    await driver.start({ platformName: 'iOS' });
    await driver.tap('hall-tab');
    await driver.fill('staging-confirmation-input', 'CONFIRM');
    assert.equal((await driver.screenshot()).toString(), 'PNG');
    await driver.close();
    assert.deepEqual(calls.filter(call => call.url.endsWith('/element')).map(call => call.body.value),
      ['hall-tab', 'staging-confirmation-input']);
    assert.ok(calls.some(call => call.method === 'DELETE' && call.url === '/session/test-session'));
  } finally {
    server.close();
  }
});
