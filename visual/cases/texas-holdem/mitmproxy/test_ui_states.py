"""校验新视觉夹具的范围、鉴权、释放及真实支付隔离。"""

import json
import unittest
from unittest.mock import patch
from test_texas_replay import ROOM, OTHER, SELF, flow, socket_flow, message
from addon import TexasVisualProxy


class UIStateTests(unittest.TestCase):
    def setUp(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.addon = TexasVisualProxy()
        self.addon.scenario = 'visual-stable'
        self.addon.texas.arm_created_room(ROOM, SELF)

    def request(self, path, method='GET', body=None, host='api.shafayouxi.org'):
        request = flow(f'https://{host}{path}', method, json.dumps(body or {}).encode())
        self.addon.request(request)
        return request

    def control(self, body, token='test-token'):
        request = flow('http://test-mitmproxy.invalid/texas/ui', 'POST', json.dumps(body).encode(), token)
        self.addon.request(request)
        return request

    def test_control_requires_authentication_room_and_valid_state(self):
        for body in ([], {'rpcError': 'unknown'}, {'applications': 'unknown'}, {'other': True}):
            self.assertEqual(self.control(body).response.status_code, 400)
        self.assertEqual(self.control({'rpcError': 'auth'}, None).response.status_code, 403)
        self.assertIsNone(self.addon.ui.rpc_error)
        self.addon.texas.release()
        self.assertEqual(self.control({'rpcError': 'auth'}).response.status_code, 400)

    def test_application_rows_and_pagination_only_match_current_room(self):
        self.control({'applications': 'more'})
        path = f'/v11/buy_in/{ROOM}/applications'
        first = json.loads(self.request(path).response.content)['result']
        self.assertEqual(len(first['applications']), 2)
        self.assertEqual(first['next_page'], 'visual-next')
        second = json.loads(self.request(path + '?next_page=visual-next').response.content)['result']
        self.assertEqual(len(second['applications']), 1)
        self.assertEqual(second['next_page'], '')
        self.assertIsNone(self.request(path + '?next_page=other').response)
        self.assertIsNone(self.request(f'/v11/buy_in/{OTHER}/applications').response)
        self.assertIsNone(self.request(path, 'POST').response)
        self.assertIsNone(self.request(path, host='production.example.com').response)
        self.control({'applications': 'resolved'})
        rows = json.loads(self.request(path).response.content)['result']['applications']
        self.assertEqual([item['status'] for item in rows], ['approve', 'reject', 'overdue'])

    def test_selection_mutations_cannot_reach_other_rooms(self):
        for suffix in ('enable_auto_rebuy', 'disable_auto_rebuy'):
            path = f'/v10/texas_holdem/room/{ROOM}/user_settings/{suffix}'
            self.assertIsNotNone(self.request(path, 'PUT').response)
            self.assertIsNone(self.request(path, 'POST').response)
            self.assertIsNone(self.request(path.replace(ROOM, OTHER), 'PUT').response)
        for method in ('PUT', 'DELETE'):
            path = f'/v10/texas_holdem/room/{ROOM}/hand_prediction'
            self.assertIsNotNone(self.request(path, method).response)
            self.assertIsNone(self.request(path.replace(ROOM, OTHER), method).response)
        self.assertIsNone(self.request(path, 'POST').response)

    def test_payment_isolation_matches_room_method_and_exact_action(self):
        frame = {'id': 9, 'method': 9, 'params': {'data': {'method': 'POST', 'path': '/v3/pay_action/do',
                 'json': {'action_url': {'room_id': ROOM, 'method': 'POST', 'path':
                 '/v10/texas_holdem/room/$room_id$/game/$game_id$/operating_time'}}}}}
        self.assertTrue(self.addon.texas.is_replay_rpc(frame))
        action = frame['params']['data']['json']['action_url']
        for key, value in [('room_id', OTHER), ('method', 'PUT'), ('path', '/other')]:
            original = action[key]
            action[key] = value
            self.assertFalse(self.addon.texas.is_replay_rpc(frame))
            action[key] = original

    def test_rpc_errors_are_injected_to_browser_and_reset_on_release(self):
        self.control({'rpcError': 'auth'})
        socket = socket_flow()
        frame = {'id': 4, 'method': 9, 'params': {'data': {'method': 'POST',
                 'path': f'/v10/texas_holdem/room/{ROOM}/game/visual-fixed-game/call'}}}
        msg = message(socket, [frame])
        with patch('texas_replay.ctx.master', create=True) as master:
            self.addon.texas.websocket_message(socket)
            reply = json.loads(master.commands.call.call_args.args[3])
            self.assertEqual(reply['result']['data']['message'], 'Access Token Not Found')
            self.assertFalse(reply['result']['data']['ok'])
            self.assertTrue(msg.dropped)
        release = flow('http://test-mitmproxy.invalid/texas/release', 'POST', b'{}', 'test-token')
        self.addon.request(release)
        self.assertIsNone(self.addon.ui.rpc_error)
        self.assertIsNone(self.addon.texas.ui_states)


if __name__ == '__main__':
    unittest.main()
