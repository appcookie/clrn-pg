"""验证真实创建响应、回放归属和 HTTP 边界，避免误操作其他房间。"""

import json
import unittest
from unittest.mock import patch
from mitmproxy import http
from test_zhajinhua_replay import flow, ROOM, OTHER, SELF
from zhajinhua_replay import PLAYER_IDS
from addon import ZhajinhuaVisualProxy


class ZhajinhuaAddonTests(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = ZhajinhuaVisualProxy()
        self.addon.scenario = 'visual-stable'

    def creation(self, game_type='zhajinhua', ok=True, room=ROOM, host='api.shafayouxi.org', method='POST'):
        request = flow(f'https://{host}/v3/pay_action/do', method, json.dumps({
            'user_id': SELF, 'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': game_type},
        }).encode())
        request.response = http.Response.make(200, json.dumps({'ok': ok, 'result': {'room_id': room}}).encode())
        self.addon.response(request)

    def control(self, path, body, token='test-token'):
        request = flow(f'http://test-mitmproxy.invalid{path}', 'POST', json.dumps(body).encode(), token)
        self.addon.request(request)
        return request

    def test_readiness_is_authenticated_read_only_and_errors_are_redacted(self):
        self.addon.created_room_id = ROOM
        replay = self.addon.replay
        before = (replay.room_id, replay.replayed_messages)
        request = flow('http://test-mitmproxy.invalid/zhajinhua/replay-ready', 'POST',
                       json.dumps({'roomId': ROOM}).encode(), 'test-token')
        self.addon.control(request)
        self.assertEqual(request.response.status_code, 200)
        self.assertFalse(request.response.json()['ready'])
        self.assertEqual((replay.room_id, replay.replayed_messages), before)
        unauthorized = flow('http://test-mitmproxy.invalid/zhajinhua/replay-ready', 'POST',
                            json.dumps({'roomId': ROOM}).encode())
        self.addon.control(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        rejected = flow('http://test-mitmproxy.invalid/zhajinhua/replay', 'POST',
                        json.dumps({'roomId': ROOM, 'data': {'private': 'secret'}}).encode(), 'test-token')
        self.addon.control(rejected)
        self.assertEqual(rejected.response.status_code, 400)
        self.assertEqual(rejected.response.json()['errorCode'], 'room_not_subscribed')
        self.assertEqual(rejected.response.json()['confirmedSubscriptions'], 0)
        for value in (ROOM, 'test-token', 'secret'):
            self.assertNotIn(value, rejected.response.text)

    def test_only_successful_zhajinhua_creation_owns_replay(self):
        for kwargs in ({'game_type': 'texas_react_native'}, {'ok': False}, {'room': '123456'},
                       {'host': 'production.example.com'}, {'method': 'PUT'}):
            self.creation(**kwargs)
            self.assertIsNone(self.addon.created_room_id)
        self.creation()
        self.assertEqual(self.addon.created_room_id, ROOM)
        self.creation(room=OTHER)
        self.assertEqual(self.addon.created_room_id, ROOM)
        # 开局前观察流量仍真实；首次回放之前不隔离状态查询。
        self.assertIsNone(self.addon.replay.room_id)

    def test_replay_requires_created_room_and_authorized_control(self):
        payload = {'roomId': ROOM, 'data': {'stream': 'zhajinhua', 'queue': []}}
        self.assertEqual(self.control('/zhajinhua/replay', payload).response.status_code, 400)
        self.creation()
        self.assertEqual(self.control('/zhajinhua/replay', payload, None).response.status_code, 403)
        with patch.object(self.addon.replay, 'publish') as publish:
            self.assertEqual(self.control('/zhajinhua/replay', dict(payload, roomId=OTHER)).response.status_code, 400)
            publish.assert_not_called()
            self.assertEqual(self.control('/zhajinhua/replay', payload).response.status_code, 200)
            publish.assert_called_once_with(ROOM, payload['data'])
        self.assertEqual(self.control('/texas/replay', payload).response.status_code, 400)
        self.control('/zhajinhua/release', {})
        self.assertIsNone(self.addon.created_room_id)
        self.assertIsNone(self.addon.replay.room_id)

    def test_http_fixtures_preserve_mutations_other_users_and_hosts(self):
        self.addon.replay.room_id, self.addon.replay.self_id = ROOM, SELF
        path = f'/v10/profile/{PLAYER_IDS[0]}'
        for method in ('POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
            request = flow(f'https://api.shafayouxi.org{path}', method)
            self.addon.request(request)
            self.assertIsNone(request.response)
        for url in (f'https://production.example.com{path}',
                    f'https://api.shafayouxi.org/v10/profile/{OTHER}',
                    f'https://api.staging.laiwan.shafayouxi.com.evil.test{path}'):
            request = flow(url)
            self.addon.request(request)
            self.assertIsNone(request.response)
        request = flow(f'https://api.shafayouxi.org{path}')
        self.addon.request(request)
        self.assertEqual(json.loads(request.response.content)['result']['nickname'], 'Player1')

    def test_current_user_is_real_and_mixed_profiles_only_add_virtual_opponents(self):
        self.addon.replay.room_id, self.addon.replay.self_id = ROOM, SELF
        for path in (f'/v10/profile/{SELF}', f'/v10/wallet/{SELF}/currency/coin'):
            request = flow('https://api.shafayouxi.org' + path)
            self.addon.request(request)
            self.assertIsNone(request.response)
        player = PLAYER_IDS[0]
        request = flow('https://api.shafayouxi.org/v10/profile/users', 'PUT',
                       json.dumps({'users': [SELF, player]}).encode())
        self.addon.request(request)
        self.assertIsNone(request.response)
        self.assertEqual(request.request.json()['users'], [SELF])
        real = {'nickname': 'Real name', 'new_field': 42}
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {SELF: real}}).encode())
        self.addon.response(request)
        self.assertEqual(request.response.json()['result'][SELF], real)
        self.assertEqual(request.response.json()['result'][player]['nickname'], 'Player1')


if __name__ == '__main__':
    unittest.main()
