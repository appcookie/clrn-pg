/** 使用应用的 Centrifuge 恢复协议，真实牌桌组件负责绘制全部夹具。 */
export const REPLAY_PLAYER_IDS = [1, 2, 3, 4].map(index =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
const communityCards = ['ah', 'kd', '7c', '2s', 'qs'];
const cardCounts = { preflop: 0, flop: 3, turn: 4, river: 5 };

export type TableOptions = {
  observer?: boolean; full?: boolean; pots?: number[];
  validBets?: Record<string, Record<string, number>>;
};

/**
 * 构造指定玩家和回合的固定牌桌回放数据。
 * @param self - 本轮登录玩家的用户 ID。
 * @param street - 牌局回合：翻牌前、翻牌、转牌或河牌。
 * @param opponentTurn - 是否恢复为对手操作回合。
 * @param options - 本次操作的可选配置。
 */
export function restoreTable(self: string, street: Street, opponentTurn = false, options: TableOptions = {}) {
  const others = options.full ? Array.from({ length: 8 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`) : REPLAY_PLAYER_IDS;
  const players = options.observer ? others : [self, ...others];
  const positions = options.full
    ? ['BTN', 'SB', 'BB', 'UTG', 'MP1', 'MP2', 'MP3', 'HJ', 'CO']
    : ['D', 'SB', 'BB', 'UTG', 'CO'];
  const status = {
    state: 'gaming', operating_seconds: 120, remain_seconds: 3600,
    settings: { small_blind: 1, big_blind: 2, ante: 0 },
    small_blind: 1, big_blind: 2, ante: 0, variation: 'texas_holdem',
    game_variation: {}, pattern: 'tradition', number: 1, street,
    community_card: communityCards.slice(0, cardCounts[street]),
    pots: options.pots || (street === 'preflop' ? [6] : [120, 60]),
    seats: Array.from({ length: 9 }, (_, index) => ({
      number: index + 1, state: index < players.length ? 'occupied' : 'empty',
      position: positions[index] || '', reserve: {},
      player: index < players.length ? {
        player_id: players[index], seat_number: index + 1, stack: 1000 - index * 40,
        buy_in: 1000, is_leave: false, is_playing: true,
        position: positions[index],
        last_action: { name: index === 3 ? 'fold' : 'call', amount: 20 },
        public_hole_card: [], hole_card: [],
      } : null,
    })),
  };
  return {
    stream: 'texas_holdem', sent_at: new Date().toISOString(),
    queue: [
      { event: 'room_status', status: { ...status, state: 'running' } },
      { event: 'game_status', game_id: 'visual-fixed-game', status },
      { event: 'table_status', status },
      ...(options.observer ? [] : [{ event: 'hand_card', player_id: self, hole_card: ['as', 'ad'], hand_strength: 'one_pair' }]),
      { event: 'operating_player_status', status: {
        player_id: opponentTurn || options.observer ? others[0] : self,
        remain_operating_seconds: 120,
        valid_bets: options.validBets || { fold: {}, call: { amount: 20 }, raise: { minimum: 40, maximum: 1000 },
          all_in: { amount: 1000 } },
      } },
      ...(options.observer ? [] : [{ event: 'hand_analyse', hand_power: 82 }]),
    ],
  };
}

/**
 * 为事件队列补齐固定回放时间与消息外层结构。
 * @param queue - 按播放顺序排列的固定游戏事件。
 */
export function events(queue: Record<string, unknown>[]) {
  return { stream: 'texas_holdem', sent_at: new Date().toISOString(), queue };
}
