"""记录本轮真实登录和建房响应，供持有代理控制令牌的测试进程清理房间。"""

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

PRESENTATION = json.loads((Path(__file__).resolve().parents[2]
    / 'visual/fixtures/game-presentation.json').read_text())

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'


class GameSession:
    def __init__(self, game_type):
        self.game_type = game_type
        self.account = None
        self.room = None

    def response(self, flow):
        if not flow.response or flow.response.status_code != 200:
            return
        path = urlsplit(flow.request.path).path
        if flow.request.method != 'POST':
            return
        try:
            body = flow.response.json()
            if body.get('ok') is not True:
                return
            data = body.get('result', {})
            if path == '/public/v10/user/login/username/password':
                token = data.get('api_token', {})
                if (re.fullmatch(UUID, data.get('user_id', ''), re.I)
                        and data.get('username') and token.get('access_token') and token.get('token_type')):
                    self.account = {'userId': data['user_id'], 'username': data['username'],
                        'authorization': f"{token['token_type']} {token['access_token']}"}
            if path == '/v3/pay_action/do' and self.account and not self.room:
                request = json.loads(flow.request.content)
                action = request.get('action_url', {})
                config = request.get('action_json', {})
                if (action.get('method') == 'POST'
                        and action.get('path') in ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room')
                        and config.get('game_type') == self.game_type
                        and re.fullmatch(UUID, data.get('room_id', ''), re.I)):
                    url = urlsplit(flow.request.pretty_url)
                    self.room = {'roomId': data['room_id'], 'apiOrigin': f'{url.scheme}://{url.netloc}',
                        'authorization': self.account['authorization']}
        except (ValueError, TypeError, AttributeError):
            return

    def normalize_room(self, path, method, body):
        """仅稳定本轮已创建房间的展示房号；真实 UUID、权限、连接和清理信息不变。"""
        if not self.room or method != 'GET' or path != f"/v1/room/{self.room['roomId']}":
            return False
        if not isinstance(body, dict) or body.get('ok') is not True:
            return False
        result = body.get('result')
        if not isinstance(result, dict) or result.get('room_id') != self.room['roomId']:
            return False
        options = result.get('options')
        if not isinstance(options, dict) or type(options.get('house_number')) not in (str, int):
            return False
        options['house_number'] = PRESENTATION['roomNumber']
        return True
