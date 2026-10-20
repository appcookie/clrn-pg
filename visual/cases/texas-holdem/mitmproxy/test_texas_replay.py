"""使用真实 mitmproxy flow 验证注入方向、隔离和混合批次。"""

import json
import unittest
from unittest.mock import patch
from mitmproxy import websocket
from wsproto.frame_protocol import Opcode
from mitmproxy import connection, http
from texas_replay import TexasReplay, PLAYER_IDS
with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from addon import TexasVisualProxy as NetworkFaults


def flow(url, method='GET', body=b'', token=None):
    result = http.HTTPFlow(
        connection.Client(peername=('127.0.0.1', 12345), sockname=('127.0.0.1', 8080)),
        connection.Server(address=('api.shafayouxi.org', 443)), live=True)
    result.request = http.Request.make(method, url, body)
    if token:
        result.request.headers['X-E2E-Control-Token'] = token
    return result

ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
SELF = '33333333-3333-4333-8333-333333333333'
CHANNEL = f'texas_holdem>{ROOM}#{SELF}'


def socket_flow():
    result = flow('https://64.kr-seoul.api.staging.laiwan.shafayouxi.com/v2/centrifugo/connection/websocket')
    result.websocket = websocket.WebSocketData()
    return result


def message(result, frames, from_client=True, injected=False):
    content = '\n'.join(json.dumps(frame) for frame in frames).encode()
    msg = websocket.WebSocketMessage(Opcode.TEXT, from_client, content, injected=injected)
    result.websocket.messages.append(msg)
    return msg


class TexasReplayTests(unittest.TestCase):
    def setUp(self):
        self.replay = TexasReplay()
        self.socket = socket_flow()
        message(self.socket, [{'id': 1, 'method': 1, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        message(self.socket, [{'id': 1, 'result': {}}], False)
        self.replay.websocket_message(self.socket)

    def test_publish_waits_for_successful_subscription_ack(self):
        pending_socket = socket_flow()
        message(pending_socket, [{'id': 60, 'method': 1, 'params': {'channel': f'texas_holdem>{OTHER}#{SELF}'}}])
        self.replay.websocket_message(pending_socket)
        with self.assertRaises(ValueError):
            self.replay.publish(OTHER, {})
        message(pending_socket, [{'id': 99, 'result': {}}, {'id': 60, 'error': {'code': 103}}], False)
        self.replay.websocket_message(pending_socket)
        with self.assertRaises(ValueError):
            self.replay.publish(OTHER, {})
        message(pending_socket, [{'id': 61, 'method': 1, 'params': {'channel': f'texas_holdem>{OTHER}#{SELF}'}}])
        self.replay.websocket_message(pending_socket)
        message(pending_socket, [{'id': 61, 'result': {}}], False)
        self.replay.websocket_message(pending_socket)
        with patch('texas_replay.ctx.master', create=True) as master:
            self.replay.publish(OTHER, {})
            self.assertEqual(master.commands.call.call_args.args[1], pending_socket)

    def test_server_unsubscribe_removes_confirmed_channel_and_preserves_frame(self):
        unsubscribe = {'result': {'type': 3, 'channel': CHANNEL, 'data': {'code': 2500}}}
        msg = message(self.socket, [unsubscribe], False)
        self.replay.websocket_message(self.socket)
        self.assertFalse(msg.dropped)
        self.assertEqual(json.loads(msg.content), unsubscribe)
        with self.assertRaises(ValueError):
            self.replay.publish(ROOM, {})

    def test_client_unsubscribe_cancels_pending_ack_and_socket_end_clears_pending(self):
        message(self.socket, [{'id': 62, 'method': 1, 'params': {'channel': CHANNEL}},
                              {'id': 63, 'method': 2, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        message(self.socket, [{'id': 62, 'result': {}}], False)
        self.replay.websocket_message(self.socket)
        with self.assertRaises(ValueError):
            self.replay.publish(ROOM, {})
        message(self.socket, [{'id': 64, 'method': 1, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        self.replay.websocket_end(self.socket)
        self.assertNotIn(self.socket.id, self.replay.pending_subscriptions)

    def test_publish_goes_to_browser_and_requires_matching_live_room(self):
        payload = {'stream': 'texas_holdem', 'queue': [{'event': 'room_status'}]}
        with patch('texas_replay.ctx.master', create=True) as master:
            self.replay.publish(ROOM, payload)
            args = master.commands.call.call_args.args
            self.assertEqual(args[:3], ('inject.websocket', self.socket, True))
            decoded = json.loads(args[3])
            self.assertEqual(decoded['result']['channel'], CHANNEL)
            self.assertEqual(decoded['result']['data']['data'], payload)
            self.assertEqual(args[4], True)
            with self.assertRaises(ValueError):
                self.replay.publish(OTHER, payload)
            self.socket.websocket.timestamp_end = 123
            with self.assertRaises(ValueError):
                self.replay.publish(ROOM, payload)

    def test_mixed_batch_keeps_ping_and_unrelated_rpc_and_blocks_only_replay_room(self):
        self.replay.room_id = ROOM
        ping = {'id': 2, 'method': 7}
        unrelated = {'id': 3, 'method': 9, 'params': {'data': {
            'path': f'/v10/texas_holdem/room/{OTHER}/game/test/call'}}}
        bet = {'id': 4, 'method': 9, 'params': {'data': {
            'path': f'/v10/texas_holdem/room/{ROOM}/game/test/call'}}}
        msg = message(self.socket, [ping, bet, unrelated])
        with patch('texas_replay.ctx.master', create=True) as master:
            self.replay.websocket_message(self.socket)
            self.assertEqual([json.loads(line) for line in msg.text.splitlines()], [ping, unrelated])
            args = master.commands.call.call_args.args
            self.assertTrue(args[2])
            self.assertEqual(json.loads(args[3])['id'], 4)
            other_socket = socket_flow()
            untouched = message(other_socket, [bet])
            self.replay.websocket_message(other_socket)
            self.assertFalse(untouched.dropped)
            self.assertEqual(master.commands.call.call_count, 1)

    def test_server_push_filter_preserves_rpc_and_injected_messages(self):
        self.replay.room_id = ROOM
        publication = {'result': {'channel': CHANNEL}}
        reply = {'id': 10, 'result': {'data': {}}}
        msg = message(self.socket, [publication, reply], False)
        self.replay.websocket_message(self.socket)
        self.assertEqual(json.loads(msg.content), reply)
        injected = message(self.socket, [publication], False, True)
        self.replay.websocket_message(self.socket)
        self.assertFalse(injected.dropped)

    def test_profiles_are_scoped_and_release_clears_fixtures(self):
        self.replay.room_id = ROOM
        self.replay.self_id = SELF
        self.assertIsNone(self.replay.http_fixture(f'/v10/profile/{OTHER}'))
        profiles = self.replay.http_fixture('/v10/profile/users', json.dumps({'users': PLAYER_IDS}).encode())
        self.assertEqual(profiles[PLAYER_IDS[0]]['nickname'], 'Player1')
        self.replay.release()
        self.assertIsNone(self.replay.http_fixture(f'/v10/profile/{PLAYER_IDS[0]}'))
        self.assertIsNone(self.replay.self_id)

    def test_push_filter_preserves_other_streams_unsubscribe_and_malformed_results(self):
        self.replay.room_id = ROOM
        unrelated = {'result': {'channel': f'chat>{ROOM}#{SELF}', 'type': 0}}
        unsubscribe = {'result': {'channel': CHANNEL, 'type': 3}}
        malformed = {'result': []}
        msg = message(self.socket, [unrelated, unsubscribe, malformed], False)
        self.replay.websocket_message(self.socket)
        self.assertEqual([json.loads(line) for line in msg.text.splitlines()],
                         [unrelated, unsubscribe, malformed])

    def test_unsubscribe_and_closed_sockets_cannot_receive_replay(self):
        message(self.socket, [{'id': 2, 'method': 2, 'params': {'channel': CHANNEL}}])
        self.replay.websocket_message(self.socket)
        with self.assertRaises(ValueError):
            self.replay.publish(ROOM, {})
        self.replay.websocket_end(self.socket)
        self.assertNotIn(self.socket.id, self.replay.subscriptions)

    def test_created_room_isolated_before_subscription_and_release_restores_traffic(self):
        self.replay.arm_created_room(ROOM, SELF)
        unregistered = socket_flow()
        seat = {'id': 40, 'method': 9, 'params': {'data': {
            'method': 'PUT', 'path': f'/v10/texas_holdem/room/{ROOM}/enter_and_sit'}}}
        other_room = {'id': 41, 'method': 9, 'params': {'data': {
            'method': 'PUT', 'path': f'/v10/texas_holdem/room/{OTHER}/enter_and_sit'}}}
        msg = message(unregistered, [seat, other_room])
        with patch('texas_replay.ctx.master', create=True) as master:
            self.replay.websocket_message(unregistered)
            self.assertEqual(json.loads(msg.content), other_room)
            self.assertEqual(json.loads(master.commands.call.call_args.args[3])['id'], 40)
            self.replay.release()
            restored = message(unregistered, [seat])
            self.replay.websocket_message(unregistered)
            self.assertFalse(restored.dropped)
            self.assertEqual(master.commands.call.call_count, 1)

    def test_payment_rpc_matches_action_room_path_and_methods_and_returns_game_shape(self):
        self.replay.room_id = ROOM
        action = {'method': 'PUT', 'room_id': ROOM, 'game_id': 'visual-fixed-game',
                  'path': '/v10/texas_holdem/room/$room_id$/game/$game_id$/check_community_card'}
        def command(path='/v3/pay_action/do', method='POST', payload=action):
            return {'id': 42, 'method': 9, 'params': {'data': {
                'path': path, 'method': method, 'json': {'action_url': payload}}}}
        self.assertTrue(self.replay.is_replay_rpc(command()))
        for frame in (command(method='GET'), command(payload=dict(action, method='POST')),
                      command(payload=dict(action, room_id=OTHER)),
                      command(payload=dict(action, path='/v1/room/$room_id$/timer')),
                      command(path='/v3/pay_action/price')):
            self.assertFalse(self.replay.is_replay_rpc(frame))
        data = self.replay.rpc_result(command())
        self.assertEqual(len(data['result']['community_card']), 5)
        call = {'params': {'data': {'path': f'/v10/texas_holdem/room/{ROOM}/game/test/call'}}}
        self.assertEqual(self.replay.rpc_result(call)['result']['level_up']['new_level'], 6)

    def test_active_created_room_cannot_be_replaced_with_another_subscribed_room(self):
        self.replay.arm_created_room(ROOM, SELF)
        message(self.socket, [{'id': 50, 'method': 1, 'params': {
            'channel': f'texas_holdem>{OTHER}#{SELF}'}}])
        self.replay.websocket_message(self.socket)
        with self.assertRaises(ValueError):
            self.replay.publish(OTHER, {})
        self.assertEqual(self.replay.room_id, ROOM)

    def test_rtc_responses_keep_chatroom_model_fields_and_do_not_target_other_rooms(self):
        self.replay.arm_created_room(ROOM, SELF)
        for action in ('join', 'quit'):
            frame = {'method': 9, 'params': {'data': {'path': f'/v1/chat_room/{ROOM}/{action}'}}}
            self.assertTrue(self.replay.is_replay_rpc(frame))
            result = self.replay.rpc_result(frame)['result']
            self.assertEqual(result['users'], [SELF])
            self.assertEqual(result['has_joined'], action == 'join')
        frame['params']['data']['path'] = f'/v1/chat_room/{OTHER}/join'
        self.assertFalse(self.replay.is_replay_rpc(frame))

    def test_scenario_changes_release_replay_and_control_requires_token(self):
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            addon = NetworkFaults()
        addon.scenario = 'visual-stable'
        addon.texas.room_id = ROOM
        unauthorized = flow('http://test-mitmproxy.invalid/texas/release', 'POST', b'{}')
        addon.control(unauthorized)
        self.assertEqual(unauthorized.response.status_code, 403)
        self.assertEqual(addon.texas.room_id, ROOM)
        clear = flow('http://test-mitmproxy.invalid/scenario', 'POST', b'{"scenario":null}', 'test-token')
        addon.control(clear)
        self.assertEqual(clear.response.status_code, 200)
        self.assertIsNone(addon.texas.room_id)


if __name__ == '__main__':
    unittest.main()
