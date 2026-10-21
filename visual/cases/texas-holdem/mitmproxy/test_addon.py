"""验证德州代理的控制鉴权和 HTTP 回放范围，不访问真实服务。"""

import json
import unittest
from unittest.mock import patch
from mitmproxy import http

from test_texas_replay import flow, ROOM, OTHER, SELF
from texas_replay import PLAYER_IDS
from addon import TexasVisualProxy


class TexasAddonTests(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = TexasVisualProxy()
        self.addon.scenario = 'visual-stable'
        self.addon.texas.room_id = ROOM
        self.addon.texas.self_id = SELF

    def request(self, path, method='GET', body=None, host='api.shafayouxi.org'):
        request = flow(f'https://{host}{path}', method,
                       b'' if body is None else json.dumps(body).encode())
        self.addon.request(request)
        return request

    def test_read_fixtures_do_not_hide_mutations_or_other_users(self):
        player = PLAYER_IDS[0]
        for path in (f'/v10/profile/{player}', f'/v10/wallet/{player}/currency/coin',
                     f'/v1/texas_statistics/player/{player}/rounds/100'):
            self.assertIsNotNone(self.request(path).response)
            for method in ('PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'):
                self.assertIsNone(self.request(path, method).response)
        self.assertIsNone(self.request(f'/v10/profile/{OTHER}').response)
        self.assertIsNone(self.request('/v10/profile/users', 'PUT', {'users': [player, OTHER]}).response)
        profiles = self.request('/v10/profile/users', 'PUT', {'users': [player, SELF]})
        self.assertIsNone(profiles.response)
        original = {'ok': True, 'new_metadata': 'kept', 'result': {
            SELF: {'nickname': 'Real user', 'new_field': 42}}}
        profiles.response = http.Response.make(200, json.dumps(original).encode())
        self.addon.response(profiles)
        result = profiles.response.json()
        self.assertEqual(result['result'][SELF], original['result'][SELF])
        self.assertEqual(result['result'][player]['nickname'], 'Player1')
        self.assertEqual(result['new_metadata'], 'kept')
        for path in (f'/v10/profile/{SELF}', f'/v10/wallet/{SELF}/currency/coin',
                     f'/v1/texas_statistics/player/{SELF}/rounds/100'):
            self.assertIsNone(self.request(path).response)

    def test_block_fixture_only_intercepts_replay_players_and_known_methods(self):
        path = '/v1/hall_matching/blacklist'
        for method in ('POST', 'DELETE'):
            self.assertIsNotNone(self.request(path, method, {'black_user_id': PLAYER_IDS[0]}).response)
            self.assertIsNone(self.request(path, method, {'black_user_id': OTHER}).response)
            self.assertIsNone(self.request(path, method, []).response)
        for method in ('GET', 'PUT', 'OPTIONS'):
            self.assertIsNone(self.request(path, method, {'black_user_id': PLAYER_IDS[0]}).response)

    def test_only_created_room_self_statistics_get_is_stable(self):
        path = f'/v1/texas_statistics/player/{SELF}/rounds/100'
        self.assertIsNone(self.request(path).response)
        self.addon.texas.arm_created_room(ROOM, SELF)
        for rounds in (100, 1000):
            current = f'/v1/texas_statistics/player/{SELF}/rounds/{rounds}'
            self.assertEqual(self.request(current).response.json()['result']['total_hands'], rounds)
            for method in ('PUT', 'POST', 'PATCH', 'DELETE', 'OPTIONS'):
                self.assertIsNone(self.request(current, method).response)
            self.assertIsNone(self.request(current, host='production.example.com').response)
        for current in (f'/v10/profile/{SELF}', f'/v10/wallet/{SELF}/currency/coin',
                        f'/v1/texas_statistics/player/{OTHER}/rounds/100',
                        f'/v1/texas_statistics/player/{SELF}/rounds/10', path + '/extra'):
            self.assertIsNone(self.request(current).response)
        self.addon.texas.created_room_id = OTHER
        self.assertIsNone(self.request(path).response)
        self.addon.texas.release()
        self.assertIsNone(self.request(path).response)

    def test_private_statistics_authorization_never_arms_rpc_or_other_reads(self):
        path = f'/v1/texas_statistics/player/{SELF}/rounds/100'
        self.assertIsNone(self.addon.view.mode)
        self.assertIsNone(self.request(path).response)
        self.addon.texas.arm_statistics(ROOM, SELF)
        self.assertIsNone(self.addon.texas.created_room_id)
        self.assertEqual(self.request(path).response.json()['result']['total_hands'], 100)
        status = flow('http://test-mitmproxy.invalid/status', 'GET', b'', 'test-token')
        self.addon.request(status)
        self.assertEqual(status.response.json()['selfStatistics'], {'authorized': True, 'responses': 1})
        for identity in (ROOM, SELF, 'test-token'):
            self.assertNotIn(identity, status.response.text)
        for method in ('POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
            self.assertIsNone(self.request(path, method).response)
        for current in (f'/v10/profile/{SELF}', f'/v10/wallet/{SELF}/currency/coin',
                        f'/v1/texas_statistics/player/{OTHER}/rounds/100', path + '/extra'):
            self.assertIsNone(self.request(current).response)
        self.addon.texas.self_id = OTHER
        self.assertIsNone(self.request(path).response)
        self.addon.texas.self_id = SELF
        self.addon.texas.room_id = OTHER
        self.assertIsNone(self.request(path).response)
        self.addon.texas.room_id = ROOM
        self.addon.texas.release()
        self.addon.texas.room_id, self.addon.texas.self_id = ROOM, SELF
        self.assertIsNone(self.request(path).response)
        self.assertEqual(self.addon.texas.self_statistics_responses, 0)


    def test_production_hosts_and_disabled_scenarios_always_pass_through(self):
        paths = ('/public/v13/metadata/servers', '/node/v1/status',
                 f'/v10/profile/{PLAYER_IDS[0]}')
        for path in paths:
            self.assertIsNone(self.request(path, host='production.example.com').response)
            self.assertIsNone(self.request(path, host='api.staging.laiwan.shafayouxi.com.evil.test').response)
        self.addon.scenario = None
        for path in paths:
            self.assertIsNone(self.request(path).response)

    def test_malformed_or_unauthorized_control_cannot_change_replay(self):
        for body in (b'[]', b'null', b'{', b'{}', b'{"scenario":"club-failure"}'):
            request = flow('http://test-mitmproxy.invalid/scenario', 'POST', body, 'test-token')
            self.addon.request(request)
            self.assertEqual(request.response.status_code, 400)
            self.assertEqual(self.addon.texas.room_id, ROOM)
        unauthorized = flow('http://test-mitmproxy.invalid/scenario', 'POST', b'{"scenario":null}')
        self.addon.request(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertEqual(self.addon.texas.room_id, ROOM)

    def test_new_record_version_control_is_authenticated_and_released(self):
        path = '/public/v11/game_log/available.json'
        unauthorized = flow('http://test-mitmproxy.invalid/texas/records', 'POST', b'{"empty":true}')
        self.addon.request(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertFalse(self.addon.records.enabled)
        for body in (b'{}', b'[]', b'{"empty":"true"}'):
            invalid = flow('http://test-mitmproxy.invalid/texas/records', 'POST', body, 'test-token')
            self.addon.request(invalid)
            self.assertEqual(invalid.response.status_code, 400)
            self.assertFalse(self.addon.records.enabled)
        valid = flow('http://test-mitmproxy.invalid/texas/records', 'POST', b'{"empty":true}', 'test-token')
        self.addon.request(valid)
        self.assertEqual(valid.response.status_code, 200)
        version = self.request(path)
        self.assertIsNone(version.response)
        version.response = http.Response.make(200, b'{"ok":true,"result":{"available_url_version":"v1","extra":1}}')
        self.addon.response(version)
        self.assertEqual(version.response.json()['result'], {'available_url_version': 'v11', 'extra': 1})
        self.assertIsNone(self.request(path, host='production.example.com').response)
        release = flow('http://test-mitmproxy.invalid/texas/release', 'POST', b'{}', 'test-token')
        self.addon.request(release)
        self.assertFalse(self.addon.records.enabled)
        self.assertIsNone(self.request(path).response)


if __name__ == '__main__':
    unittest.main()
