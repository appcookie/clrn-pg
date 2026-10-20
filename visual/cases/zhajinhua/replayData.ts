/** 拼三张的三张手牌、轮数、单底池与比牌协议独立于德州。 */
export const PLAYER_IDS = [1, 2, 3, 4].map(index =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
/**
 * 为事件队列补齐固定回放时间与消息外层结构。
 * @param queue - 按播放顺序排列的固定游戏事件。
 */
export const events = (queue: Record<string, unknown>[]) => ({
  stream: 'zhajinhua', sent_at: new Date().toISOString(), queue,
});

/**
 * 构造指定玩家和回合的固定牌桌回放数据。
 * @param self - 本轮登录玩家的用户 ID。
 * @param opponent - 是否轮到对手操作。
 * @param seen - 是否已查看手牌。
 */
export function restoreTable(self: string, opponent = false, seen = false) {
  const players = [self, ...PLAYER_IDS];
  const status = {
    state: 'gaming', operating_seconds: 120, remain_seconds: 3600,
    settings: { boot: 1, raise_times: 10, must_blind_round: 0, challenge_limit_round: 1,
      max_round: 20, pot_limit: 2000 },
    variation: 'classic', game_variation: {}, pattern: 'tradition', number: 1,
    ante: 1, max_round: 20, round_count: 3, pot: { pot_amount: 120, pot_limit: 2000 },
    seats: Array.from({ length: 9 }, (_, index) => ({
      number: index + 1, state: index < players.length ? 'occupied' : 'empty', position: index === 0 ? 'D' : '', reserve: {},
      player: index < players.length ? {
        player_id: players[index], seat_number: index + 1, stack: 1000 - index * 40,
        buy_in: 1000, is_leave: false, is_playing: true, is_seen_card: index === 0 && seen, is_lose: false,
        position: index === 0 ? 'D' : '', last_action: { name: 'call', amount: 10 },
        public_hole_card: [], hole_card: [],
      } : null,
    })),
  };
  return events([
    { event: 'room_status', status: { ...status, state: 'running' } },
    { event: 'game_status', game_id: 'visual-fixed-zhajinhua-game', status },
    ...(seen ? [{ event: 'hand_card', player_id: self, hole_card: ['as', 'ad', 'ac'],
      hand_strength: 'three_of_a_kind' }] : []),
    { event: 'operating_player_status', status: {
      player_id: opponent ? players[1] : self, remain_operating_seconds: 120,
      valid_bets: validBets(seen && !opponent),
    } },
    { event: 'table_status', status },
  ]);
}

/**
 * 看牌后按双倍跟注额展示操作；对手仍保持闷牌。
 * @param seen - 是否已查看手牌。
 */
export function validBets(seen: boolean) {
  const call = seen ? 20 : 10;
  return { fold: {}, call: { amount: call }, challenge: { amount: call * 2 },
    raise: { minimum: call * 2, maximum: call * 10, step: call }, all_in: { amount: 1000 } };
}
