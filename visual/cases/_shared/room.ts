import type { APIRequestContext } from '@playwright/test';
import { expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 30_000 });
import { canTopUpVisualAccount } from '../../test-account';
import { requestErrorSummary } from '../../src/support/requestError';

export type RoomSession = { roomId: string; apiOrigin: string; authorization: string };
export type Account = { userId: string; username: string; authorization: string };
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 读取真实钱包响应中的钻石余额，拒绝缺失币种或非数值余额。
 * @param request - Web 或原生测试使用的真实 API 请求客户端。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
async function readDiamondBalance(request: APIRequestContext, account: Account): Promise<number> {
  const response = await request.put(`https://api.shafayouxi.org/v10/wallet/${account.userId}`, {
    headers: { Authorization: account.authorization },
    data: { currencies: ['diamond'] },
  }).catch(error => {
    throw new Error(`读取测试钻石余额请求失败：${requestErrorSummary(error)}`);
  });
  const body = await response.json();
  await response.dispose();
  if (!response.ok() || body?.ok !== true) throw new Error('无法读取视觉测试账号钻石余额');
  const diamond = body.result?.currencies?.find((item: { code: string }) => item.code === 'diamond');
  const balance = Number(diamond?.balance);
  if (!Number.isFinite(balance)) throw new Error('视觉测试账号钻石余额无效');
  return balance;
}

/**
 * 确认建房钻石足够，仅允许为受支持的测试账号补充余额。
 * @param request - Web 或原生测试使用的真实 API 请求客户端。
 * @param account - 包含用户 ID、账号接口与认证信息的会话。
 */
export async function ensureRoomBalance(request: APIRequestContext, account: Account): Promise<void> {
  if (await readDiamondBalance(request, account) >= 10) return;
  if (!canTopUpVisualAccount(account.username)) {
    throw new Error('仅允许为本轮使用的固定视觉测试账号自动补钻');
  }
  const token = process.env.TESTING_API_TOKEN?.trim();
  if (!token) throw new Error('账号不足 10 钻；需要 TESTING_API_TOKEN 为 staging 测试账号补钻');
  const response = await fetch(`https://api.shafayouxi.org/public/v1/wallet/${account.userId}/set_balance/testing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Testing-Api-Token': token },
    body: JSON.stringify({ currency_name: 'diamond', balance: '60' }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true || body.result?.wallet_id !== account.userId
    || body.result?.currency_name !== 'diamond' || Number(body.result?.balance) !== 60) {
    throw new Error('staging 测试账号补钻结果无效');
  }
  await expect.poll(() => readDiamondBalance(request, account)).toBe(60);
}

/**
 * 只删除本用例创建响应中的 UUID；即使截图失败也执行。
 * @param room - 本轮创建并负责清理的房间信息或 ID。
 */
export async function deletePrivateGameRoom(room: RoomSession): Promise<void> {
  if (!ROOM_ID_PATTERN.test(room.roomId)) throw new Error('清理房间需要本轮创建响应中的有效 UUID');
  // 固定 staging 入口；客户端选中的地区代理可能已不可用，收尾不再依赖该节点。
  const response = await fetch(`https://api.shafayouxi.org/v1/room/${room.roomId}`, {
    method: 'DELETE', headers: { Authorization: room.authorization },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  expect(response.ok && body?.ok === true, `本次新建房间应成功解散（HTTP ${response.status}，业务成功=${body?.ok === true}）`).toBe(true);
  console.log('ROOM CLEANUP > 本次新建房间已解散');
}
