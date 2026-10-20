/** 真实 staging 业务校验；凭据只存在进程内存，不进入附件或错误消息。 */
import { randomBytes } from 'node:crypto';
import { expect } from '@playwright/test';
export type Credentials = { username: string; password: string };
export type Session = { userId: string; authorization: string; origin: string; username: string };
export type ApiResponse = { status: number; body: any; url: string; method: string; requestBody?: any };
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function stagingOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
    !(url.origin === 'https://api.shafayouxi.org' || url.hostname.endsWith('.api.staging.laiwan.shafayouxi.com'))) {
    throw new Error('业务请求只允许已校验的 staging API');
  }
  return url.origin;
}
export function success(response: ApiResponse): any {
  expect(response.status, `${response.method} ${new URL(response.url).pathname} HTTP`).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  expect(response.body?.ok, '业务响应应成功').toBe(true);
  return response.body.result;
}
export async function request(session: Session | undefined, method: string, path: string, body?: unknown, origin = session?.origin || 'https://api.shafayouxi.org'): Promise<ApiResponse> {
  const url = new URL(path, stagingOrigin(origin));
  if (url.origin !== stagingOrigin(origin)) throw new Error('禁止请求跨 staging 来源');
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: session.authorization } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error(`staging ${method} 请求未完成（敏感请求信息已省略）`); }
  let parsed: any;
  try { parsed = await response.json(); } catch { throw new Error(`staging ${method} 返回无效 JSON`); }
  return { status: response.status, body: parsed, url: url.href, method, requestBody: body };
}
export async function accountStatus(session: Session): Promise<number> { return (await request(session, 'GET', `/v11/user/${session.userId}/account`)).status; }
export async function balances(session: Session): Promise<Record<string, string>> {
  const result = success(await request(session, 'PUT', `/v10/wallet/${session.userId}`, { currencies: ['coin', 'diamond'] }));
  expect(Array.isArray(result?.currencies)).toBe(true);
  const amounts: Record<string, string> = {};
  for (const coin of result.currencies) {
    expect(Number.isFinite(Number(coin.balance))).toBe(true);
    amounts[coin.code] = String(coin.balance);
  }
  for (const coin of ['coin', 'diamond']) expect(amounts[coin]).toBeDefined();
  return amounts;
}
export async function diamond(session: Session): Promise<number> { return Number((await balances(session)).diamond); }
export function credentials(creation = false): Credentials {
  const username = process.env[creation ? 'E2E_CREATION_USERNAME' : 'E2E_TEST_USERNAME'] || (!creation ? process.env.IOS_USERNAME : undefined);
  const password = process.env[creation ? 'E2E_CREATION_PASSWORD' : 'E2E_TEST_PASSWORD'] || (!creation ? process.env.IOS_PASSWORD : undefined);
  if (!username || !password) throw new Error(`缺少 ${creation ? 'E2E_CREATION' : 'E2E_TEST'}_USERNAME/PASSWORD；功能测试不会跳过或自动注册已有账号`);
  return { username, password };
}
export function token(): string { const value = process.env.TESTING_API_TOKEN?.trim(); if (!value) throw new Error('缺少 TESTING_API_TOKEN；创建数据测试不会跳过'); return value; }
async function testing(path: string, body: unknown): Promise<any> {
  const key = token(); let response: Response;
  try { response = await fetch(`https://api.shafayouxi.org${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': key }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error('staging 测试接口请求失败；不会自动重试'); }
  if (!response.ok) throw new Error(`staging 测试接口 HTTP ${response.status}`);
  let data: any; try { data = await response.json(); } catch { throw new Error('staging 测试接口返回无效 JSON'); }
  if (data?.ok !== true) throw new Error('staging 测试接口业务失败');
  return data.result;
}
export async function createAccount(): Promise<Credentials & { userId: string }> {
  const account = { username: `ios${randomBytes(7).toString('hex')}`, password: `T${randomBytes(7).toString('hex')}9` };
  const result = await testing('/public/v10/user/register/username_password/testing', account);
  if (!uuid.test(result?.user_id) || result.username !== account.username) throw new Error('测试注册响应账号不匹配');
  return { ...account, userId: result.user_id };
}
export async function fund(session: Session): Promise<void> {
  stagingOrigin(session.origin); if (!uuid.test(session.userId)) throw new Error('非法创建账号 UUID');
  const result = await testing(`/public/v1/wallet/${session.userId}/set_balance/testing`, { currency_name: 'diamond', balance: '60' });
  expect(result.wallet_id).toBe(session.userId); expect(result.currency_name).toBe('diamond'); expect(Number(result.balance)).toBe(60);
  await expect.poll(() => diamond(session)).toBe(60);
}
export async function deleteRoom(session: Session, roomId: string): Promise<void> {
  if (!uuid.test(roomId)) throw new Error('只允许清理本次成功创建响应的精确 UUID');
  success(await request(session, 'DELETE', `/v1/room/${roomId}`));
}
