"""验证订阅取证的协议分类、脱敏、有界性和故障隔离。"""

import json
import unittest
from unittest.mock import patch
from mitmproxy import websocket
import test_node_passthrough as fixtures
from test_node_passthrough import proxy, ROOM, OTHER, USER
from test_network_observer import flow
from room_subscription_diagnostics import history


class RoomSubscriptionDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.addon = proxy('texas-holdem')
        self.addon.game_session.room = {'roomId': ROOM}
        self.socket = flow('/v2/centrifugo/connection/websocket')
        self.socket.websocket = websocket.WebSocketData()
        self.channel = f'texas_holdem>{ROOM}#{USER}'

    def send(self, frame, from_client=True):
        msg = fixtures.NativeNodeTests.send(self.addon, self.socket, [frame], from_client)
        self.assertEqual(json.loads(msg.content), frame)
        self.assertFalse(msg.dropped)

    def request(self, command):
        self.send({'method': 1, 'id': command, 'params': {'channel': self.channel}})

    def test_记录拒绝确认撤销和断连且消息保持原样(self):
        self.request(1)
        self.send({'id': 1, 'error': {'code': 103, 'message': 'private-token'}}, False)
        self.request(2)
        self.send({'id': 2, 'result': {}}, False)
        self.send({'result': {'type': 3, 'channel': self.channel, 'data': {'code': 2500}}}, False)
        self.request(3)
        self.send({'method': 2, 'id': 4, 'params': {'channel': self.channel}})
        self.request(5)
        self.addon.websocket_end(self.socket)
        state = self.addon.transport_snapshot()['roomSubscription']
        self.assertFalse(state['ready'])
        self.assertEqual([e['event'] for e in state['events']], [
            'requested', 'rejected', 'requested', 'confirmed', 'server-unsubscribe',
            'requested', 'client-unsubscribe', 'requested', 'connection-ended'])
        self.assertEqual(state['events'][1]['code'], 103)
        self.assertEqual(state['events'][4]['code'], 2500)
        for secret in (ROOM, USER, self.channel, 'private-token', self.socket.id):
            self.assertNotIn(secret, json.dumps(state))

    def test_有界且忽略其他房间并在换房时清空(self):
        self.send({'method': 1, 'id': 1, 'params': {'channel': f'texas_holdem>{OTHER}#{USER}'}})
        self.assertEqual(list(history(self.addon)), [])
        for command in range(70):
            self.request(command + 2)
        self.assertEqual(len(history(self.addon)), 64)
        self.addon.game_session.room = {'roomId': OTHER}
        self.assertEqual(list(history(self.addon)), [])

    def test_诊断故障不能改变订阅确认或原始异常(self):
        with patch('room_subscription_diagnostics.history', side_effect=RuntimeError('diagnostic failed')):
            self.request(1)
            self.send({'id': 1, 'result': {}}, False)
            state = self.addon.transport_snapshot()['roomSubscription']
            self.assertTrue(state['ready'])
            self.assertTrue(state['eventsUnavailable'])
            with patch.object(self.addon.game, 'websocket_message', side_effect=ValueError('original failure')):
                with self.assertRaisesRegex(ValueError, 'original failure'):
                    self.request(2)
            self.addon.websocket_end(self.socket)
