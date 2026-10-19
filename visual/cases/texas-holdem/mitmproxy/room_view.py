"""只修改本次真实创建的房间显示配置，服务端仍保留私人房等待状态。"""

import json
import re
from texas_replay import UUID


class RoomView:
    def __init__(self):
        self.mode = None
        self.room_id = None
        self.self_id = None

    def configure(self, mode):
        if mode not in (None, 'hall', 'record-v2', 'guest'):
            raise ValueError('Unknown room view')
        self.mode, self.room_id, self.self_id = mode, None, None

    def response(self, flow, path):
        if not self.mode or not flow.response or flow.response.status_code != 200:
            return
        try:
            body = json.loads(flow.response.content)
            result = body.get('result')
            if body.get('ok') is not True or not isinstance(result, dict):
                return
            if flow.request.method == 'POST' and path == '/v3/pay_action/do' and not self.room_id:
                request = json.loads(flow.request.content)
                action = request.get('action_url')
                config = request.get('action_json')
                user_id = request.get('user_id')
                if not isinstance(action, dict) or not isinstance(config, dict) or (
                    action.get('method') != 'POST' or action.get('path') not in (
                        '/v2/building/$building_id$/room', '/v2/building/<building_id>/room') or
                    config.get('game_type') not in ('texas_holdem', 'texas_react_native') or
                    not isinstance(user_id, str) or not re.fullmatch(UUID, user_id, re.I)):
                    return
                room_id = result.get('room_id')
                if isinstance(room_id, str) and re.fullmatch(UUID, room_id, re.I):
                    self.room_id = room_id
                    self.self_id = user_id
            if self.mode == 'hall' and flow.request.method == 'GET' and self.room_id and path == f'/v1/room/{self.room_id}':
                result['building_type'] = 'hall'
                result.setdefault('game_config', {})['prediction_currency'] = 'coin'
                result['game_config']['currency'] = 'coin'
                flow.response.content = json.dumps(body).encode()
            if self.mode == 'guest' and flow.request.method == 'GET' and self.room_id and path == f'/v1/room/{self.room_id}':
                result['creator_id'] = '00000000-0000-4000-8000-000000000001'
                result['admin_ids'] = []
                flow.response.content = json.dumps(body).encode()
        except (ValueError, TypeError, AttributeError):
            return

    def fixture(self, path, method, self_id, content=b''):
        if self.mode != 'hall' or not self.room_id:
            return None
        if method == 'PUT' and path == f'/v10/texas_holdem/room/{self.room_id}/user_settings':
            return {'auto_rebuy': False}
        if method != 'GET':
            return None
        if path == f'/v10/texas_holdem/room/{self.room_id}/hand_prediction/rule':
            return {'rules': [{'prediction_type': 'pair', 'name': 'Pair', 'multiplier': 2,
                              'currency_name': 'coin', 'prediction_amount_range': [10, 20],
                              'default_prediction_amount': 10}]}
        return None
