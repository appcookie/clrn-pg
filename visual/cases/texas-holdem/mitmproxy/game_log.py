"""只回放当前隔离房间和当前用户的一局战绩，不替换其他游戏日志。"""

import json
from texas_replay import PLAYER_IDS

GAME_ID = 'visual-fixed-game'
CARDS = ['ah', 'kd', '7c', '2s', 'qs']


def game(self_id):
    players = [
        {'player_id': self_id, 'seat_number': 1, 'position': 'D', 'stack': 1000},
        {'player_id': PLAYER_IDS[0], 'seat_number': 2, 'position': 'SB', 'stack': 1000}]
    showdown = [dict(players[0], hole_card=['as', 'ad'], strength_cards=['as', 'ad', 'ah'],
                     hand_strength='three_of_a_kind', is_max_strength=True),
                dict(players[1], hole_card=['kh', 'ks'], strength_cards=['kh', 'ks', 'kd'],
                     hand_strength='three_of_a_kind', is_max_strength=False)]
    return {'game_id': GAME_ID, 'game_at': '2026-01-01T12:00:00Z', 'actions': [
        {'action_name': 'begin_play', 'game': {'variation': 'texas_holdem'}, 'table': {'players': players}},
        {'action_name': 'deal_hole_card', 'player_id': self_id, 'hole_card': ['as', 'ad']},
        {'action_name': 'small_blind', 'player_id': PLAYER_IDS[0], 'amount': 1, 'stack': 999},
        {'action_name': 'big_blind', 'player_id': self_id, 'amount': 2, 'stack': 998},
        {'action_name': 'call', 'player_id': PLAYER_IDS[0], 'amount': 20, 'stack': 979},
        {'action_name': 'pots_updated', 'pots': [180]},
        {'action_name': 'start_street', 'street': 'river', 'community_card': CARDS},
        {'action_name': 'check', 'player_id': self_id},
        {'action_name': 'showdown', 'players': showdown},
        {'action_name': 'settlement', 'players': [dict(players[0], net=180), dict(players[1], net=-180)]}]}


def fixture(path, method, content, room_id, self_id):
    if not room_id or not self_id:
        return None
    if method == 'GET' and path == f'/v1/game_log/room/{room_id}/settlement':
        return {'settlements': [{'user_id': player_id, 'buy_in_amount': 1000,
                                'game_round_amount': 10, 'settlement_amount': 180 if index == 0 else -180}
                               for index, player_id in enumerate([self_id, *PLAYER_IDS])]}
    if method != 'PUT':
        return None
    body = json.loads(content or b'{}')
    if path == '/v1/game_log/room/game_amount' and body.get('room_ids') == [room_id]:
        return {'results': [{'room_id': room_id, 'game_amount': 1}]}
    if path == f'/v1/game_log/room/{room_id}/game' and body.get('game_numbers') == [1]:
        return {'results': [{'game_id': GAME_ID}]}
    if path == f'/v1/game_log/user/{self_id}/games' and body.get('game_ids') == [GAME_ID]:
        return {'results': [game(self_id)]}
    return None
