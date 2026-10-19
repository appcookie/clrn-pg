"""新版牌谱必须使用本轮真实入房会话，且解除回放后不再拦截。"""

import json
import unittest
from mitmproxy import http
from records_v2 import RecordsV2, ROUND
from test_texas_replay import flow, ROOM, SELF, OTHER


class RecordsV2Tests(unittest.TestCase):
    def setUp(self):
        self.records = RecordsV2()

    def enter(self, room=ROOM, method='PUT', ok=True, session=OTHER, status=200):
        request = flow(f'https://api.shafayouxi.org/v10/texas_holdem/room/{room}/enter', method)
        request.response = http.Response.make(status, json.dumps({
            'ok': ok, 'result': {'play_session_id': session}}).encode())
        self.records.response(request, request.request.path, ROOM)

    def test_version_is_opt_in_and_read_only(self):
        path = '/public/v11/game_log/available.json'
        self.assertIsNone(self.records.fixture(path, 'GET', SELF))
        self.records.configure(True)
        self.assertIsNone(self.records.fixture(path, 'GET', None))
        for method in ('PUT', 'POST', 'DELETE', 'OPTIONS'):
            self.assertIsNone(self.records.fixture(path, method, SELF))
        for invalid in (None, 0, 'true', []):
            with self.assertRaises(ValueError):
                self.records.configure(invalid)

    def test_only_successful_enter_of_created_room_records_session(self):
        self.enter()
        self.assertIsNone(self.records.session_id)
        self.records.configure(True)
        for kwargs in ({'room': OTHER}, {'method': 'GET'}, {'ok': False},
                       {'status': 500}, {'session': 'bad/session'}):
            self.enter(**kwargs)
            self.assertIsNone(self.records.session_id)
        self.enter()
        self.assertEqual(self.records.session_id, OTHER)
        self.enter(session='session-1')
        self.assertEqual(self.records.session_id, 'session-1')

    def test_records_require_exact_user_session_and_round(self):
        self.records.configure(True)
        record = f'/v11/game_log/{SELF}/play_session_record/{OTHER}'
        detail = f'/v11/game_log/{SELF}/round/{ROUND}'
        self.assertIsNone(self.records.fixture(record, 'GET', SELF))
        self.enter()
        self.assertEqual(self.records.fixture(record, 'GET', SELF), {'all_round_id': []})
        self.assertIsNone(self.records.fixture(detail, 'GET', SELF))
        self.records.configure(False)
        self.assertEqual(self.records.fixture(record, 'GET', SELF), {'all_round_id': [ROUND]})
        self.assertEqual(self.records.fixture(detail, 'GET', SELF)['seats']['1'], SELF)
        for path in (record.replace(SELF, ROOM), record.replace(OTHER, ROOM), detail + '-other'):
            self.assertIsNone(self.records.fixture(path, 'GET', SELF))
        self.assertIsNone(self.records.fixture(detail, 'POST', SELF))
        self.records.release()
        self.assertIsNone(self.records.fixture(detail, 'GET', SELF))
        self.assertIsNone(self.records.session_id)


if __name__ == '__main__':
    unittest.main()
