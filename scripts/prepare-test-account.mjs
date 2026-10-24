import { randomUUID } from 'node:crypto';

const stagingOrigin = 'https://api.shafayouxi.org';
export const initialCoinBalance = '10000';

/** Only emit known transport codes, never an exception message containing request secrets. */
export function transportFailureCode(error) {
  const code = error?.cause?.code || error?.code;
  const allowed = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED',
    'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID']);
  if (allowed.has(code)) return code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'REQUEST_TIMEOUT';
  if (error?.cause?.message === 'unexpected redirect') return 'REDIRECT_REFUSED';
  return 'TRANSPORT_ERROR';
}
/**
 * 从环境或本机 staging 部署文件读取测试令牌，持续集成禁止回退到文件。
 * @param environment - 当前进程的环境配置。
 * @param deploymentFile - 本机共用 staging Secret 所在文件。
 */
export async function readTestingApiToken(environment = process.env) {
  const token = environment.TESTING_API_TOKEN?.trim();
  if (token) return token;
  throw new Error('缺少 TESTING_API_TOKEN，无法准备测试账号金币余额');
}

/**
 * 只请求固定 staging 入口；拒绝重定向，所有失败均保留阶段且去除敏感正文。
 * @param path - 固定业务路径。
 * @param method - 请求方法。
 * @param body - 请求 JSON 数据。
 * @param headers - 当前接口所需的认证头。
 * @param stage - 不含凭据的阶段描述。
 */
async function requestJson(path, method, body, headers, stage) {
  let response;
  try {
    response = await fetch(`${stagingOrigin}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`${stage}请求失败（${transportFailureCode(error)}）`);
  }
  if (!response.ok) throw new Error(`${stage}失败（HTTP ${response.status}）`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`${stage}返回无效 JSON`);
  }
  if (result?.ok !== true || !result.result) throw new Error(`${stage}业务响应失败`);
  return result.result;
}

/**
 * 在账号独占锁内、启动客户端前设置固定金币，再通过真实钱包接口核对。
 * 此准备会创建短期登录会话，客户端仍需完成正常初始化及真实登录。
 * @param account - 本任务已独占账号的用户名、密码及可选的已登记用户 ID。
 * @param token - 仅在 Node 进程使用的测试接口令牌。
 */
export async function prepareTestAccountCoins(account, token) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('缺少 TESTING_API_TOKEN');
  if (typeof account?.username !== 'string' || !/^[a-zA-Z0-9.]{6,30}$/.test(account.username)
    || typeof account.password !== 'string' || !account.password || account.password.length > 20
    || /[\r\n\0]/.test(account.password)) throw new Error('测试账号凭据无效');
  const session = await requestJson('/public/v10/user/login/username/password', 'POST', {
    username: account.username, password: account.password, device_id: randomUUID(),
  }, {}, '准备账号登录');
  const userId = session.user_id;
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    || session.username !== account.username || (account.userId !== undefined && account.userId !== userId)
    || !/^Bearer$/i.test(session.api_token?.token_type)
    || typeof session.api_token.access_token !== 'string' || !session.api_token.access_token
    || /[\r\n]/.test(session.api_token.access_token)) throw new Error('准备账号登录返回身份或会话不符');
  const result = await requestJson(`/public/v1/wallet/${userId}/set_balance/testing`, 'POST', {
    currency_name: 'coin', balance: initialCoinBalance,
  }, { 'X-Testing-Api-Token': token }, '设置测试金币');
  if (result.wallet_id !== userId || result.currency_name !== 'coin'
    || Number(result.balance) !== Number(initialCoinBalance)) throw new Error('设置测试金币返回钱包、币种或余额不符');
  const wallet = await requestJson(`/v10/wallet/${userId}`, 'PUT', { currencies: ['coin'] }, {
    Authorization: `${session.api_token.token_type} ${session.api_token.access_token}`,
  }, '核对测试金币');
  const coins = Array.isArray(wallet.currencies) ? wallet.currencies.filter(currency => currency?.code === 'coin') : [];
  if (coins.length !== 1 || Number(coins[0].balance) !== Number(initialCoinBalance)) {
    throw new Error('核对测试金币失败，实际余额不是 10000');
  }
  return { userId, authorization: `${session.api_token.token_type} ${session.api_token.access_token}` };
}
