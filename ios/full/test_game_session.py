"""只允许登记本轮真实登录后创建的目标玩法房间，用于失败清理。"""

import copy
import json
import unittest
from types import SimpleNamespace
from game_session import GameSession

USER = '10000000-0000-0000-0000-000000000001'
ROOM = '20000000-0000-0000-0000-000000000001'


def flow(path, result, request=None, ok=True):
    return SimpleNamespace(request=SimpleNamespace(method='POST', path=path,
        pretty_url='https://api.shafayouxi.org' + path, content=json.dumps(request).encode()),
        response=SimpleNamespace(status_code=200, json=lambda: {'ok': ok, 'result': result}))


def login():
    return flow('/public/v10/user/login/username/password', {'user_id': USER, 'username': 'test-only',
        'api_token': {'token_type': 'Bearer', 'access_token': 'test-token'}})


def room(game='texas_holdem', room_id=ROOM):
    return flow('/v3/pay_action/do', {'room_id': room_id}, {
        'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
        'action_json': {'game_type': game}})


class GameSessionTests(unittest.TestCase):
    def test_statistics_owner_requires_actual_created_room_and_matching_logged_in_self(self):
        for user_id in (None, ROOM, USER):
            session = GameSession('texas_holdem')
            session.response(login())
            created = room()
            body = json.loads(created.request.content)
            body['user_id'] = user_id
            created.request.content = json.dumps(body).encode()
            session.response(created)
            self.assertEqual(session.statistics_owner, (ROOM, USER) if user_id == USER else None)
        for login_first, method, game, status in ((False, 'POST', 'texas_holdem', 200),
                (True, 'GET', 'texas_holdem', 200), (True, 'POST', 'zhajinhua', 200),
                (True, 'POST', 'texas_holdem', 500)):
            session = GameSession('texas_holdem')
            if login_first:
                session.response(login())
            created = room(game)
            body = json.loads(created.request.content)
            body['user_id'] = USER
            created.request.content = json.dumps(body).encode()
            created.request.method = method
            created.response.status_code = status
            session.response(created)
            self.assertIsNone(session.statistics_owner)

    def test_only_first_created_target_room_is_owned(self):
        session = GameSession('texas_holdem')
        session.response(room())
        self.assertIsNone(session.room)
        session.response(login())
        session.response(room('zhajinhua'))
        session.response(room(room_id='not-a-uuid'))
        self.assertIsNone(session.room)
        session.response(room())
        session.response(room(room_id=USER))
        self.assertEqual(session.room, {'roomId': ROOM, 'apiOrigin': 'https://api.shafayouxi.org',
            'authorization': 'Bearer test-token'})

    def test_failed_and_malformed_responses_never_create_ownership(self):
        session = GameSession('texas_holdem')
        failed = login()
        failed.response.status_code = 401
        session.response(failed)
        self.assertIsNone(session.account)
        session.response(login())
        for result in (None, [], {'room_id': None}):
            session.response(flow('/v3/pay_action/do', result))
        failed = room()
        failed.response.json = lambda: {'ok': False, 'result': {'room_id': ROOM}}
        session.response(failed)
        self.assertIsNone(session.room)

    def test_room_presentation_preserves_real_identity_and_only_changes_own_number(self):
        session = GameSession('texas_holdem')
        session.response(login())
        session.response(room())
        body = {'ok': True, 'result': {'room_id': ROOM, 'creator_id': USER,
            'options': {'house_number': '987654321', 'allow_player_rtc': True},
            'game_config': {'small_blind': 1}, 'room_status': 'waiting'}}
        original = copy.deepcopy(body)
        ownership = copy.deepcopy(session.room)
        for path, method in [(f'/v1/room/{USER}', 'GET'), (f'/v1/room/{ROOM}', 'DELETE')]:
            self.assertFalse(session.normalize_room(path, method, body))
            self.assertEqual(body, original)
        self.assertTrue(session.normalize_room(f'/v1/room/{ROOM}', 'GET', body))
        original['result']['options']['house_number'] = '123456789'
        self.assertEqual(body, original)
        self.assertEqual(session.room, ownership)

    def test_room_presentation_never_hides_errors_or_repairs_missing_fields(self):
        session = GameSession('zhajinhua')
        session.response(login())
        session.response(room('zhajinhua'))
        for body in [None, {'ok': False, 'result': {'room_id': ROOM, 'options': {'house_number': 'old'}}},
                     {'ok': True, 'result': {'room_id': USER, 'options': {'house_number': 'other'}}},
                     {'ok': True, 'result': {'room_id': ROOM, 'options': {}}}]:
            original = copy.deepcopy(body)
            self.assertFalse(session.normalize_room(f'/v1/room/{ROOM}', 'GET', body))
            self.assertEqual(body, original)


if __name__ == '__main__':
    unittest.main()
