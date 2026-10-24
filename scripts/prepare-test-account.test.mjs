import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTestAccountCoins, readTestingApiToken, transportFailureCode } from './prepare-test-account.mjs';

const userId = '11111111-2222-4333-8444-555555555555';
const account = { username: 'parallel01', password: 'private-password', userId };
const token = 'private-testing-token';
const session = { user_id: userId, username: account.username,
  api_token: { token_type: 'Bearer', access_token: 'private-session-token' } };
const prepared = { wallet_id: userId, currency_name: 'coin', balance: '10000' };
const wallet = { currencies: [{ code: 'coin', balance: '10000' }] };

test('网络诊断仅公开已知错误代码，保留原因且不泄露请求凭据', () => {
  assert.equal(transportFailureCode({ cause: { code: 'ECONNRESET', message: token } }), 'ECONNRESET');
  assert.equal(transportFailureCode({ cause: { code: token, message: account.password } }), 'TRANSPORT_ERROR');
  assert.equal(transportFailureCode({ cause: { message: 'unexpected redirect' } }), 'REDIRECT_REFUSED');
  assert.equal(transportFailureCode({ name: 'TimeoutError' }), 'REQUEST_TIMEOUT');
});

/**
 * 只替换网络边界，记录真实准备逻辑的全部请求。
 * @param context - 当前测试上下文。
 * @param replies - 按调用顺序返回的网络结果。
 */
function network(context, replies = [session, prepared, wallet]) {
  const calls = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    const reply = replies[calls.length - 1];
    if (reply instanceof Error) throw reply;
    if (reply instanceof Response) return reply;
    assert.ok(reply, '不允许额外网络请求');
    return Response.json({ ok: true, result: reply });
  });
  return calls;
}

test('设置固定金币后读取钱包核对，不设置钻石、不向其他接口发送管理令牌', async context => {
  const calls = network(context);
  await prepareTestAccountCoins(account, token);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => [new URL(call.url).pathname, call.method]), [
    ['/public/v10/user/login/username/password', 'POST'],
    [`/public/v1/wallet/${userId}/set_balance/testing`, 'POST'],
    [`/v10/wallet/${userId}`, 'PUT'],
  ]);
  assert.deepEqual(calls[0].body, { username: account.username, password: account.password,
    device_id: calls[0].body.device_id });
  assert.match(calls[0].body.device_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[1].body, { currency_name: 'coin', balance: '10000' });
  assert.deepEqual(calls[2].body, { currencies: ['coin'] });
  assert.equal(calls[0].headers['X-Testing-Api-Token'], undefined);
  assert.equal(calls[1].headers['X-Testing-Api-Token'], token);
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[2].headers['X-Testing-Api-Token'], undefined);
  assert.equal(calls[2].headers.Authorization, 'Bearer private-session-token');
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://api.shafayouxi.org');
    assert.equal(call.redirect, 'error');
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test('无用户 ID 的持续集成账号从登录结果取得身份，重复准备仍设置相同余额', async context => {
  const calls = network(context, [{ ...session, api_token: { ...session.api_token, token_type: 'bearer' } }, prepared, wallet, session, prepared, wallet]);
  for (let attempt = 0; attempt < 2; attempt++) {
    await prepareTestAccountCoins({ username: account.username, password: account.password }, token);
  }
  assert.deepEqual(calls[1].body, calls[4].body);
  assert.notEqual(calls[0].body.device_id, calls[3].body.device_id);
});

test('缺少令牌或无效凭据时不发请求', async context => {
  const calls = network(context);
  for (const invalidToken of [undefined, '', '  ']) {
    await assert.rejects(prepareTestAccountCoins(account, invalidToken), /缺少 TESTING_API_TOKEN/);
  }
  for (const invalidAccount of [undefined, {}, { ...account, username: '../other' },
    { ...account, password: '' }, { ...account, password: 'x'.repeat(21) }, { ...account, password: 'secret\n' }]) {
    await assert.rejects(prepareTestAccountCoins(invalidAccount, token), /凭据无效/);
  }
  assert.equal(calls.length, 0);
});

test('登录身份或会话异常时禁止写钱包', async context => {
  for (const invalidSession of [
    {}, { ...session, user_id: '../wallet' }, { ...session, user_id: 123 },
    { ...session, username: 'another-account' },
    { ...session, user_id: 'aaaaaaaa-2222-4333-8444-555555555555' },
    { ...session, api_token: undefined }, { ...session, api_token: { token_type: 'Bearer' } },
    { ...session, api_token: { token_type: 'Bearer', access_token: '' } },
    { ...session, api_token: { token_type: 'Bearer', access_token: 'secret\n' } },
  ]) {
    const calls = network(context, [invalidSession]);
    await assert.rejects(prepareTestAccountCoins(account, token), /身份或会话不符/);
    assert.equal(calls.length, 1);
    context.mock.restoreAll();
  }
});

test('写入结果错误或回读余额不符时明确失败', async context => {
  for (const result of [{ ...prepared, wallet_id: 'other' }, { ...prepared, currency_name: 'diamond' },
    { ...prepared, balance: '0' }]) {
    const calls = network(context, [session, result]);
    await assert.rejects(prepareTestAccountCoins(account, token), /钱包、币种或余额不符/);
    assert.equal(calls.length, 2);
    context.mock.restoreAll();
  }
  for (const result of [{}, { currencies: [] }, { currencies: [null, { code: 'diamond', balance: '10000' }] },
    { currencies: [{ code: 'coin', balance: '0' }] }, { currencies: [wallet.currencies[0], wallet.currencies[0]] }]) {
    network(context, [session, prepared, result]);
    await assert.rejects(prepareTestAccountCoins(account, token), /实际余额不是 10000/);
    context.mock.restoreAll();
  }
});

test('每个阶段的网络、认证、重定向、JSON 与业务错误都会中止，错误不泄露凭据', async context => {
  for (const stage of [0, 1, 2]) {
    for (const failure of [new Error(`network ${token}`),
      new Response(token, { status: 401 }), new Response(token, { status: 302 }), new Response(token),
      Response.json({ ok: false, error_message: token }), Response.json({ ok: true }), Response.json(null)]) {
      const calls = network(context, [...[session, prepared, wallet].slice(0, stage), failure]);
      await assert.rejects(prepareTestAccountCoins(account, token), error => {
        assert.match(error.message, /失败|无效 JSON/);
        assert.ok(!error.message.includes(token));
        assert.ok(!error.message.includes(account.password));
        return true;
      });
      assert.equal(calls.length, stage + 1);
      context.mock.restoreAll();
    }
  }
});

test('令牌优先使用环境配置，持续集成缺少令牌时禁止读取本机文件', async () => {
  assert.equal(await readTestingApiToken({ TESTING_API_TOKEN: ' secret ' }), 'secret');
  for (const environment of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    await assert.rejects(readTestingApiToken(environment), /缺少 TESTING_API_TOKEN/);
  }
});

test('本机缺少显式令牌也不读取旁边仓库部署文件', async () => {
  await assert.rejects(readTestingApiToken({}), /缺少 TESTING_API_TOKEN/);
});
