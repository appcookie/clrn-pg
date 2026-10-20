"""新版牌谱只匹配本轮创建房间的真实进入会话及固定局号。"""

import json
import re
from texas_replay import PLAYER_IDS

ROUND = 'visual-fixed-round-v2'


class RecordsV2:
    def __init__(self):
        self.release()

    def release(self):
        self.enabled = False
        self.empty = True
        self.session_id = None

    def configure(self, empty):
        if not isinstance(empty, bool):
            raise ValueError('Invalid records mode')
        self.enabled, self.empty = True, empty

    def response(self, flow, path, room_id):
        if not self.enabled or not room_id or flow.request.method != 'PUT' or (
            path != f'/v10/texas_holdem/room/{room_id}/enter') or not flow.response:
            return
        body = json.loads(flow.response.content)
        session = body.get('result', {}).get('play_session_id') if body.get('ok') is True else None
        if flow.response.status_code == 200 and isinstance(session, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session):
            self.session_id = session

    def fixture(self, path, method, self_id):
        if not self.enabled or method != 'GET':
            return None
        if not self_id or not self.session_id:
            return None
        if path == f'/v11/game_log/{self_id}/play_session_record/{self.session_id}':
            return {'all_round_id': [] if self.empty else [ROUND]}
        if not self.empty and path == f'/v11/game_log/{self_id}/round/{ROUND}':
            return round_data(self_id)
        return None


def round_data(self_id):
    return {
        'game_type': 'texas_holdem', 'seats': {'1': self_id, '2': PLAYER_IDS[0]},
        'all_seat_public': {'1': {'position': 'BTN', 'public_hole_card': 'as,ad'},
                            '2': {'position': 'SB', 'public_hole_card': 'kh,ks'}},
        'user_secret': {'hole_card': 'as,ad'},
        'actions': [
            {'name': 'small_blind', 'seat': '2', 'bet': 1, 'stack': 999},
            {'name': 'big_blind', 'seat': '1', 'bet': 2, 'stack': 998},
            {'name': 'call', 'seat': '2', 'street_bet': 20, 'stack': 980},
            {'name': 'flop', 'community_card_1_to_3': 'ah,kd,7c'},
            {'name': 'turn', 'community_card_4': '2s'},
            {'name': 'river', 'community_card_5': 'qs', 'pots': [180]},
            {'name': 'showdown', 'seat': '1', 'hole_card': 'as,ad',
             'best_hand_cards': 'as,ad,ah,kd,qs', 'hand_strength': 'three_of_a_kind'},
            {'name': 'showdown', 'seat': '2', 'hole_card': 'kh,ks',
             'best_hand_cards': 'kh,ks,kd,ah,qs', 'hand_strength': 'three_of_a_kind'},
            {'name': 'award', 'seat': '1', 'net': 90, 'prize': 180},
            {'name': 'award', 'seat': '2', 'net': -90, 'prize': 0},
        ],
    }
