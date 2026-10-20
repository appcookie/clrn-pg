import { expect } from '@playwright/test';
import { gameGone, gameNodes, gameReady, gameTap } from './game-controls';
import { gameTapText, restoreTexas, type TexasContext } from './texas-support';
import { closeGameMask } from './game-pregame';

/**
 * 复用 Web 新版牌局战绩的空、行动和结算状态。
 * @param context - 已在启动前启用新版战绩夹具的真实房间。
 */
export async function texasRecordVariants(context: TexasContext): Promise<void> {
  const { device, proxy, capture } = context;
  await restoreTexas(context);
  await gameTap(device, 'game-record-button');
  await gameReady(device, 'base-review-board-container');
  expect((await gameReady(device, 'review-board-description-text')).text).toMatch(/empty games|没有|沒有/i);
  await capture('empty');
  await closeGameMask(device, 'base-review-board-container');
  await proxy.command('texas/records', { empty: false });
  await gameTap(device, 'game-record-button');
  await gameReady(device, 'review-board-action-list');
  await expect.poll(async () => (await gameNodes(device)).some(node => node.res?.startsWith('TexasActionListV2_PlayerAction_')),
    { timeout: 30_000 }).toBe(true);
  expect((await gameReady(device, 'review-board-pot-text')).text).toContain('180');
  await capture('actions');
  await gameTapText(device, /settle|结算|結算/i);
  await gameReady(device, 'review-board-settlement-list');
  expect((await gameNodes(device)).filter(node => node.res === 'GameSettlementItemTwoV2_container')).toHaveLength(2);
  await capture('settlement');
  await closeGameMask(device, 'base-review-board-container');
}

/**
 * 验证启用升盲结构后的等待牌桌和实际配置列表。
 * @param context - 已从原生建房表单启用升盲的房间。
 */
export async function texasOptionalPreGame(context: TexasContext): Promise<void> {
  const { device, capture } = context;
  await gameReady(device, 'texas-holdem-raise-blind-button');
  await capture('waiting_table');
  await gameTap(device, 'texas-holdem-raise-blind-button');
  await gameReady(device, 'raise-blind-detail');
  await gameGone(device, 'raise-blind-loading');
  await expect.poll(async () => (await gameNodes(device)).some(node => node.text?.includes('1/2')),
    { timeout: 30_000 }).toBe(true);
  await capture('raise_blinds');
  await gameTap(device, 'raise-blind-close-button');
  await gameGone(device, 'raise-blind-detail');
}
