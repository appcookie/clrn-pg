import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS } from '../../visual/cases/texas-holdem/replayData';
import { gameGone, gameNodes, gameReady, gameTap, gameTextWithin } from './game-controls';
import { restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 复用 Web 的旁观、满桌、多底池、保座、掉线和非房主菜单状态。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasTableVariants(context: TexasContext): Promise<void> {
  const { device, capture, self } = context;
  /**
   * 等待原生树中的实际可见玩家数量。
   * @param count - 共用回放应显示的玩家数。
   */
  const countPlayers = async (count: number) => {
    await expect.poll(async () => (await gameNodes(device))
      .filter(node => node.res?.startsWith('texas-holdem-player-container-')).length, { timeout: 30_000 }).toBe(count);
  };
  /** 通过真实新一局消息清除上局牌面。 */
  const clearHand = async () => {
    await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game',
      settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
    await gameGone(device, 'player_card');
  };
  await restoreTexas(context, { observer: true });
  await texasEvents(context, [{ event: 'switch_player', player_id: REPLAY_PLAYER_IDS[0], valid_bets: { call: { amount: 20 } } }]);
  await countPlayers(4);
  expect((await gameNodes(device)).some(node => node.res?.startsWith(`texas-holdem-player-container-${self}`))).toBe(false);
  await gameGone(device, 'texas-holdem-operation-button-raise');
  await capture('observer');
  await clearHand();
  await restoreTexas(context, { full: true });
  await countPlayers(9);
  for (const position of ['BTN', 'D', 'SB', 'BB', 'UTG', 'MP1', 'MP2', 'MP3', 'HJ', 'CO']) {
    await expect.poll(async () => (await gameNodes(device)).some(node => node.text === position), { timeout: 30_000 }).toBe(true);
  }
  await capture('full_table');
  const pots = [90, 80, 70, 60, 50, 40, 30, 20, 10];
  await restoreTexas(context, { full: true, pots });
  await countPlayers(9);
  await gameReady(device, 'texas_holdem_main_pot_amount', '450');
  const container = (await gameReady(device, 'texas_holdem_side_pots_list')).bounds;
  await expect.poll(async () => {
    const nodes = await gameNodes(device);
    return pots.map((_, index) => gameTextWithin(nodes, `texas_holdem_side_pot_${index}`).join(''));
  }, { timeout: 30_000 }).toEqual(pots.map(String));
  const items = (await gameNodes(device)).filter(node => /^texas_holdem_side_pot_\d+$/.test(node.res || ''));
  expect(items).toHaveLength(pots.length);
  for (const [index, item] of items.entries()) {
    const bounds = item.bounds;
    expect(bounds.x).toBeGreaterThanOrEqual(container.x);
    expect(bounds.y).toBeGreaterThanOrEqual(container.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(container.x + container.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(container.y + container.height);
    if (index % 2 === 1) {
      expect(bounds.y).toBe(items[index - 1].bounds.y);
      expect(bounds.x).toBeGreaterThanOrEqual(items[index - 1].bounds.x + items[index - 1].bounds.width);
    }
    if (index >= 2) expect(bounds.y).toBeGreaterThanOrEqual(items[index - 2].bounds.y + items[index - 2].bounds.height);
  }
  await capture('full_table_multiple_pots');
  await texasEvents(context, Array.from({ length: 4 }, (_, index) => ({ event: 'stand_up',
    player_id: `00000000-0000-4000-8000-${String(index + 5).padStart(12, '0')}` })));
  await clearHand();
  await restoreTexas(context);
  await texasEvents(context, [{ event: 'reserve_seat', seat_number: 6,
    player_id: '00000000-0000-4000-8000-000000000005', remain_reserve_seconds: 120 }]);
  await gameReady(device, 'seat-reserve-container');
  expect((await gameReady(device, 'seat-reserve-text')).text).toMatch(/^(留座|Reserved)$/i);
  await countPlayers(5);
  expect((await gameNodes(device)).filter(node => node.res === 'player_card')).toHaveLength(8);
  await capture('reserved_seat');
  await texasEvents(context, [{ event: 'cancel_reserve_seat', seat_number: 6 }, { event: 'quit', player_id: REPLAY_PLAYER_IDS[2] }]);
  await gameReady(device, `texas-holdem-player-container-${REPLAY_PLAYER_IDS[2]}`);
  await capture('player_disconnected');
  await gameTap(device, 'menu-button');
  await gameGone(device, 'drawer-menu-item-renew');
  await gameReady(device, 'drawer-menu-item-exit');
  await capture('guest_menu');
}
