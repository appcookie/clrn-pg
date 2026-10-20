// 仅由分配器的子进程测试通过 --import 加载，不提供生产跳过余额准备的开关。
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const userId = '11111111-2222-4333-8444-555555555555';
let username;
/**
 * 替换子进程的网络边界，验证准备期间持有账号锁并按真实契约返回数据。
 * @param url - 准备逻辑发出的固定 staging 请求。
 * @param options - 请求方法、正文和认证头。
 */
globalThis.fetch = async (url, options) => {
  const body = options.body === undefined ? undefined : JSON.parse(options.body);
  const directory = dirname(process.env.GITHUB_ENV || process.env.CLRN_TEST_ACCOUNT_POOL);
  if (url.endsWith('/public/v10/user/login/username/password')) username = body.username;
  const lock = join(directory, 'locks', username.toLowerCase());
  if (process.env.GITHUB_ENV) {
    assert.equal(existsSync(process.env.GITHUB_ENV) ? readFileSync(process.env.GITHUB_ENV, 'utf8') : '', '',
      '余额核对完成前不能导出测试账号');
  } else {
    assert.ok(existsSync(lock), '余额准备必须持有该账号的锁');
  }
  assert.equal(new URL(url).origin, 'https://api.shafayouxi.org');
  assert.equal(options.redirect, 'error');
  const rejection = join(directory, 'reject-wallet');
  if (existsSync(rejection) && url.includes(readFileSync(rejection, 'utf8'))) {
    return new Response('private-token', { status: 401 });
  }
  if (url.endsWith('/public/v10/user/login/username/password')) {
    return Response.json({ ok: true, result: { user_id: userId, username,
      api_token: { token_type: 'Bearer', access_token: 'test-session' } } });
  }
  if (url.endsWith('/set_balance/testing')) {
    assert.deepEqual(body, { currency_name: 'coin', balance: '10000' });
    return Response.json({ ok: true, result: { wallet_id: userId, ...body } });
  }
  if (url.endsWith(`/v10/house/user/${userId}`)) {
    return Response.json({ ok: true, result: { house_id: userId, user_id: userId } });
  }
  if (url.endsWith('/v2/building/rooms')) {
    appendFileSync(join(directory, 'prepared-accounts'), `${username}\n`);
    return Response.json({ ok: true, result: [] });
  }
  assert.equal(new URL(url).pathname, `/v10/wallet/${userId}`);
  return Response.json({ ok: true, result: { currencies: [{ code: 'coin', balance: '10000' }] } });
};
