"""大厅配置只属于本次创建的隔离房间，禁止吞真实房间的写操作。"""
import json
import unittest
from mitmproxy import http
from room_view import RoomView
from test_texas_replay import flow, ROOM, OTHER, SELF
from game_log import fixture as log_fixture, GAME_ID


class RoomViewTests(unittest.TestCase):
    def test_only_successful_creation_arms_exact_room_read(self):
        view = RoomView()
        view.configure('hall')
        created = flow('https://api.shafayouxi.org/v3/pay_action/do', 'POST', json.dumps({
            'user_id': SELF,
            'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': 'texas_holdem'},
        }).encode())
        created.response = http.Response.make(200, json.dumps({'ok': True, 'result': {'room_id': ROOM}}).encode())
        view.response(created, '/v3/pay_action/do')
        self.assertEqual(view.room_id, ROOM)
        for room in (OTHER, ROOM):
            for method in ('GET', 'PUT', 'DELETE'):
                request = flow(f'https://api.shafayouxi.org/v1/room/{room}', method)
                original = {'ok': True, 'result': {'building_type': 'house', 'creator_id': SELF,
                                                'game_config': {'currency': 'chip'}}}
                request.response = http.Response.make(200, json.dumps(original).encode())
                view.response(request, f'/v1/room/{room}')
                result = json.loads(request.response.content)['result']
                self.assertEqual(result['building_type'], 'hall' if room == ROOM and method == 'GET' else 'house')
        self.assertEqual(view.self_id, SELF)
        view.configure(None)
        self.assertIsNone(view.room_id)
        self.assertIsNone(view.fixture(f'/v10/texas_holdem/room/{ROOM}/user_settings', 'PUT', SELF))

    def test_other_payments_failed_creations_and_second_rooms_cannot_arm_view(self):
        view = RoomView()
        view.configure('hall')
        body = {'user_id': SELF, 'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
                'action_json': {'game_type': 'texas_react_native'}}
        def created(request_body, room_id=ROOM, ok=True):
            request = flow('https://api.shafayouxi.org/v3/pay_action/do', 'POST', json.dumps(request_body).encode())
            request.response = http.Response.make(200, json.dumps({'ok': ok, 'result': {'room_id': room_id}}).encode())
            view.response(request, '/v3/pay_action/do')
        for request_body in ({}, dict(body, user_id='invalid'),
                             dict(body, action_json={'game_type': 'zhajinhua'}),
                             dict(body, action_url={'method': 'PUT', 'path': '/v1/room/$room_id$/timer'})):
            created(request_body)
            self.assertIsNone(view.room_id)
        created(body, ok=False)
        self.assertIsNone(view.room_id)
        created(body)
        self.assertEqual(view.room_id, ROOM)
        self.assertEqual(view.self_id, SELF)
        created(body, OTHER)
        self.assertEqual(view.room_id, ROOM)

    def test_room_details_never_replace_known_self_with_unvalidated_creator(self):
        view = RoomView()
        view.configure('hall')
        view.room_id, view.self_id = ROOM, SELF
        request = flow(f'https://api.shafayouxi.org/v1/room/{ROOM}')
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {
            'creator_id': [], 'game_config': {}, 'options': {},
        }}).encode())
        view.response(request, f'/v1/room/{ROOM}')
        self.assertEqual(view.self_id, SELF)

    def test_guest_identity_only_changes_successful_read_of_created_room(self):
        view = RoomView()
        view.configure('guest')
        view.room_id, view.self_id = ROOM, SELF
        for room in (ROOM, OTHER):
            for method in ('GET', 'PUT', 'DELETE'):
                for ok in (True, False):
                    path = f'/v1/room/{room}'
                    request = flow(f'https://api.shafayouxi.org{path}', method)
                    original = {'ok': ok, 'result': {'creator_id': SELF, 'admin_ids': [SELF]}}
                    request.response = http.Response.make(200, json.dumps(original).encode())
                    view.response(request, path)
                    result = json.loads(request.response.content)['result']
                    changed = room == ROOM and method == 'GET' and ok
                    self.assertEqual(result['creator_id'] != SELF, changed)
                    self.assertEqual(result['admin_ids'], [] if changed else [SELF])
        self.assertEqual(view.self_id, SELF)

    def test_logs_do_not_replace_other_room_or_user_records(self):
        path = '/v1/game_log/room/game_amount'
        self.assertIsNotNone(log_fixture(path, 'PUT', json.dumps({'room_ids': [ROOM]}).encode(), ROOM, SELF))
        self.assertIsNone(log_fixture(path, 'PUT', json.dumps({'room_ids': [OTHER, ROOM]}).encode(), ROOM, SELF))
        path = f'/v1/game_log/user/{SELF}/games'
        self.assertIsNotNone(log_fixture(path, 'PUT', json.dumps({'game_ids': [GAME_ID]}).encode(), ROOM, SELF))
        self.assertIsNone(log_fixture(path, 'PUT', json.dumps({'game_ids': ['real-game']}).encode(), ROOM, SELF))
        self.assertIsNone(log_fixture(path, 'POST', b'{}', ROOM, SELF))
        path = f'/v1/game_log/room/{ROOM}/game'
        self.assertIsNotNone(log_fixture(path, 'PUT', b'{"game_numbers":[1]}', ROOM, SELF))
        self.assertIsNone(log_fixture(path, 'PUT', b'{"game_numbers":[2]}', ROOM, SELF))


if __name__ == '__main__':
    unittest.main()
