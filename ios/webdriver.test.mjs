// 通过本地 W3C 端点验证驱动请求的协议形状和失败传播。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebDriver } from './webdriver.mjs';

test('标签切换发送中心触摸并等待原生选中状态，不依赖 click 的成功响应', async () => {
  const driver = new WebDriver();
  driver.session = 'test-session';
  const calls = [];
  let selectionReads = 0;
  driver.request = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.endsWith('/element')) return { 'element-6066-11e4-a52e-4f735466cecf': 'message' };
    if (path.endsWith('/attribute/value')) return ++selectionReads < 3 ? null : '1';
    if (path.endsWith('/rect')) return { x: 0, y: 769, width: 79, height: 49 };
    assert.ok(path.endsWith('/actions'));
  };
  await driver.selectTab('message-tab');
  assert.equal(selectionReads, 3);
  assert.equal(calls[0].body.value, 'message-tab');
  assert.deepEqual(calls.find(call => call.path.endsWith('/actions')).body, { actions: [{
    type: 'pointer', id: 'tab-touch', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: 40, y: 794 },
      { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 }, { type: 'pointerUp', button: 0 },
    ],
  }] });
  calls.length = 0;
  await driver.selectTab('message-tab');
  assert.ok(!calls.some(call => call.path.endsWith('/actions')));
});

test('WebDriver 使用原生 accessibility id 并能保存截图', async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls.push({ method: request.method, url: request.url, body: body && JSON.parse(body) });
    let value = null;
    if (request.url === '/session') value = { sessionId: 'test-session' };
    else if (request.url.endsWith('/element')) value = { 'element-6066-11e4-a52e-4f735466cecf': 'element-1' };
    else if (request.url.endsWith('/attribute/value')) value = 'CONFIRM';
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

test('WebDriver 的请求预算覆盖慢响应头与响应体，并保留 W3C 错误', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/missing') {
      response.writeHead(404).end(JSON.stringify({ value: { error: 'no such element', message: 'missing' } }));
    } else if (request.url === '/body') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.flushHeaders();
      setTimeout(() => response.end('{"value":"ready"}'), 100);
    } else setTimeout(() => response.end('{"value":"ready"}'), 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const driver = new WebDriver(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await driver.request('GET', '/slow', undefined, 500), 'ready');
    for (const path of ['/slow', '/body']) {
      await assert.rejects(driver.request('GET', path, undefined, 20), error => error.code === 'ABORT_ERR' || error.code === 'ECONNRESET');
    }
    await assert.rejects(driver.request('GET', '/missing'), { code: 'no such element' });
  } finally { server.closeAllConnections(); server.close(); }
});
