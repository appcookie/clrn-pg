"""使用真实 HTTPFlow 验证战绩代理的隔离、分页、故障及删除结果。"""

import asyncio
import json
import unittest
from unittest.mock import patch
from mitmproxy import connection, http

with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from addon import GameRecordProxy
from data import CLUB, PLAYER, PREFIX, all_records

SELF = 'visual-user'


def flow(path, method='GET', body=None, token=None, host='api.shafayouxi.org'):
    result = http.HTTPFlow(
        connection.Client(peername=('127.0.0.1', 12345), sockname=('127.0.0.1', 8080)),
        connection.Server(address=(host, 443)), live=True)
    result.request = http.Request.make(method, f'https://{host}{path}',
                                       b'' if body is None else json.dumps(body).encode())
    if token:
        result.request.headers['X-E2E-Control-Token'] = token
    return result


class RecordProxyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.proxy = GameRecordProxy()
        self.proxy.scenario = 'visual-stable'
        self.proxy.user_id = SELF
        self.proxy.mode = 'list'

    async def request(self, path, method='GET', body=None, **kwargs):
        request = flow(path, method, body, **kwargs)
        await self.proxy.request(request)
        return request

    def result(self, flow):
        return json.loads(flow.response.content)['result']

    def test_room_names_respect_ui_creation_limit(self):
        # 建房按 UTF-16 字符单元计数：ASCII 为 1，其他为 2，上限 20。
        for record in all_records():
            units = record['name'].encode('utf-16-le')
            length = sum(1 if units[i] < 128 and units[i + 1] == 0 else 2
                         for i in range(0, len(units), 2))
            self.assertLessEqual(length, 20, record['name'])
        self.assertEqual(len(next(record['name'] for record in all_records()
                                  if record['play_session_id'] == PREFIX + 'large')), 20)

    async def test_list_includes_unstarted_record_without_settlements(self):
        room_id = PREFIX + 'empty'
        legacy = self.result(await self.request(f'/v10/texas_holdem/user/{SELF}/game_records'))
        self.assertIn(room_id, [item['room_id'] for item in legacy['items']])
        v2 = self.result(await self.request(f'/v11/game_log/{SELF}/play_session_record/recent',
                                            'PUT', {'user_id': SELF}))
        unstarted = next(record for record in v2['records'] if record['play_session_id'] == room_id)
        self.assertEqual(unstarted['all_round_count'], 0)
        settlements = self.result(await self.request('/v1/game_log/room/settlement', 'PUT',
                                                      {'room_ids': [room_id]}))
        self.assertEqual(settlements['rooms_settlements'][room_id], [])
        count = self.result(await self.request('/v1/game_log/room/game_amount', 'PUT',
                                               {'room_ids': [room_id]}))
        self.assertEqual(count['results'][0]['game_amount'], 0)

    async def test_other_users_hosts_and_methods_pass_through(self):
        path = f'/v10/texas_holdem/user/{SELF}/game_records'
        self.assertIsNotNone((await self.request(path)).response)
        for host in ('production.example.com', 'api.staging.laiwan.shafayouxi.com.evil.test'):
            self.assertIsNone((await self.request(path, host=host)).response)
        self.assertIsNone((await self.request(path.replace(SELF, 'another-user'))).response)
        for method in ('POST', 'PUT', 'DELETE'):
            self.assertIsNone((await self.request(path, method)).response)
        self.proxy.scenario = None
        self.assertIsNone((await self.request(path)).response)

    async def test_mixed_unknown_rooms_and_profiles_pass_through(self):
        self.assertIsNone((await self.request('/v1/room', 'PUT',
                                              {'rooms': [PREFIX + 'private', 'real-room']})).response)
        self.assertIsNone((await self.request('/v10/profile/users', 'PUT',
                                              {'users': [SELF, 'real-user']})).response)
        self.assertIsNotNone((await self.request('/v10/clubs', 'PUT', {'club_ids': [CLUB]})).response)

    async def test_authenticated_control_validates_before_changing_state(self):
        control = {'userId': SELF, 'version': 'v2', 'mode': 'empty'}
        denied = await self.request('/records/configure', 'POST', control, host='test-mitmproxy.invalid')
        self.assertEqual(denied.response.status_code, 403)
        for invalid in ({**control, 'mode': 'invalid'}, {**control, 'userId': '../real'},
                        {**control, 'version': 'invalid'}, {**control, 'hold': 'yes'}, []):
            result = await self.request('/records/configure', 'POST', invalid,
                                        host='test-mitmproxy.invalid', token='test-token')
            self.assertEqual(result.response.status_code, 400)
            self.assertEqual(self.proxy.mode, 'list')

    async def test_pagination_has_no_missing_or_duplicate_records(self):
        self.proxy.mode = 'paged'
        path = f'/v10/texas_holdem/user/{SELF}/game_records'
        first = self.result(await self.request(path))
        second = self.result(await self.request(path + '?next_page=' + first['next_page']))
        self.assertIsNone(second['next_page'])
        ids = [item['room_id'] for item in first['items'] + second['items']]
        self.assertEqual(ids, [record['play_session_id'] for record in all_records()])
        self.assertEqual(len(first['items']), 20)
        v2 = self.result(await self.request(f'/v11/game_log/{SELF}/play_session_record/recent',
                                            'PUT', {'user_id': SELF}))
        self.assertEqual([record['play_session_id'] for record in v2['records']], ids)
        self.assertEqual(len(set(ids)), 23)
        # 删除状态跨模式保留；旧版删除成功后分页应为 20 + 2 条。
        self.proxy.deleted = [PREFIX + 'club']
        first = self.result(await self.request(path))
        second = self.result(await self.request(path + '?next_page=' + first['next_page']))
        remaining = [item['room_id'] for item in first['items'] + second['items']]
        self.assertEqual(len(first['items']), 20)
        self.assertEqual(len(second['items']), 2)
        self.assertEqual(remaining, [room_id for room_id in ids if room_id != PREFIX + 'club'])

    async def test_loading_gate_releases_without_sleep(self):
        self.proxy.hold.clear()
        task = asyncio.create_task(self.request(f'/v10/texas_holdem/user/{SELF}/game_records'))
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        await self.request('/records/release', 'POST', {}, token='test-token', host='test-mitmproxy.invalid')
        self.assertEqual((await task).response.status_code, 200)

    async def test_delete_error_keeps_record_and_success_removes_it(self):
        path = f'/v1/game_log/user/{SELF}/room/{PREFIX}club'
        self.proxy.mode = 'delete-error'
        rejected = await self.request(path, 'DELETE')
        self.assertEqual(rejected.response.status_code, 200)
        self.assertFalse(json.loads(rejected.response.content)['ok'])
        self.assertEqual(self.proxy.deleted, [])
        self.proxy.mode = 'list'
        self.assertEqual((await self.request(path, 'DELETE')).response.status_code, 200)
        page = self.result(await self.request(f'/v10/texas_holdem/user/{SELF}/game_records'))
        self.assertNotIn(PREFIX + 'club', [item['room_id'] for item in page['items']])
        self.assertIsNone((await self.request(path.replace(SELF, 'another-user'), 'DELETE')).response)

    async def test_v2_list_and_detail_faults_are_separate(self):
        self.proxy.mode = 'list-error'
        path = f'/v11/game_log/{SELF}/play_session_record/'
        self.assertEqual((await self.request(path + 'recent', 'PUT', {'user_id': SELF})).response.status_code, 503)
        self.assertEqual((await self.request(path + PREFIX + 'private')).response.status_code, 200)
        self.proxy.mode = 'detail-error'
        rejected = await self.request(path + PREFIX + 'private')
        self.assertEqual(rejected.response.status_code, 200)
        self.assertEqual(json.loads(rejected.response.content)['error_message'], 'Visual record service unavailable')
        self.assertIsNone((await self.request(path + 'real-session')).response)

    async def test_current_profile_and_version_keep_real_fields_and_errors(self):
        request = await self.request('/v10/profile/users', 'PUT', {'users': [SELF, PLAYER]})
        self.assertIsNone(request.response)
        self.assertEqual(request.request.json()['users'], [SELF])
        real = {'nickname': 'Real name', 'new_field': 42}
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {SELF: real}}).encode())
        self.proxy.response(request)
        self.assertEqual(request.response.json()['result'][SELF], real)
        self.assertEqual(request.response.json()['result'][PLAYER]['nickname'], 'Opponent')
        for version, expected in (('legacy', 'v1'), ('v2', 'v11')):
            self.proxy.version = version
            request = await self.request('/public/v11/game_log/available.json')
            self.assertIsNone(request.response)
            request.response = http.Response.make(200,
                b'{"ok":true,"result":{"available_url_version":"v11","new_field":42}}')
            self.proxy.response(request)
            self.assertEqual(request.response.json()['result'], {'available_url_version': expected, 'new_field': 42})
            request.response = http.Response.make(503, b'{"ok":false,"error":"real outage"}')
            self.proxy.response(request)
            self.assertEqual(request.response.content, b'{"ok":false,"error":"real outage"}')
        preflight = await self.request('/unrelated/protected/api', 'OPTIONS')
        self.assertIsNone(preflight.response)


if __name__ == '__main__':
    unittest.main()
