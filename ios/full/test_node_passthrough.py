"""经实际 iOS 插件入口验证多节点选线；上游健康值与错误不由视觉夹具改写。"""

import asyncio
import json
import os
import threading
import unittest
from unittest.mock import patch
from mitmproxy import http, websocket
from mitmproxy.flow import Error
from wsproto.frame_protocol import Opcode
from test_network_observer import flow
from test_proxy_bridge import module

NODES = ('64.kr-seoul.api.staging.laiwan.shafayouxi.com',
         '67.hk.api.staging.laiwan.shafayouxi.com',
         '68.kr.api.staging.laiwan.shafayouxi.com')
ROOM = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
USER = '33333333-3333-4333-8333-333333333333'


def proxy(game='', records=False):
    with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token',
            'IOS_FUNCTIONAL': 'false', 'IOS_GAME': game, 'IOS_RECORDS': str(records).lower(),
            'IOS_MATCHING': 'false', 'IOS_SLOT': 'false', 'IOS_SKELETON': 'false'}):
        return module.IosVisualProxy()


class NativeNodeTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_business_fixture_does_not_block_other_nodes(self):
        addon = proxy('texas-holdem')
        entered, release = asyncio.Event(), threading.Event()
        loop = asyncio.get_running_loop()

        def busy_fixture(_request):
            loop.call_soon_threadsafe(entered.set)
            if not release.wait(5):
                raise AssertionError('业务夹具未释放')
            return None

        with patch.dict(os.environ, {'IOS_FIXTURE_URL': 'http://127.0.0.1:12345/',
                'IOS_FIXTURE_TOKEN': 'test-only'}), patch.object(
                module.IosVisualProxy, 'fixture_response', side_effect=busy_fixture):
            pending = asyncio.create_task(addon.request(flow('/public/v10/profile/country')))
            try:
                await asyncio.wait_for(entered.wait(), 1)
                for host in NODES:
                    request = flow('/node/v1/status')
                    request.request.host = host
                    await asyncio.wait_for(addon.request(request), 1)
                    self.assertIsNone(request.response)
                self.assertFalse(pending.done())
            finally:
                release.set()
                await pending

    async def test_explicit_launch_hold_delays_get_but_preserves_preflight_and_release(self):
        addon = proxy('zhajinhua')
        addon.launch.holding = True
        addon.launch.release.clear()
        requests = [flow('/node/v1/status') for _ in NODES]
        for request, host in zip(requests, NODES):
            request.request.host = host
        tasks = [asyncio.create_task(addon.request(request)) for request in requests]
        try:
            await asyncio.sleep(0)
            self.assertEqual(addon.launch.requested, len(NODES))
            self.assertTrue(all(not task.done() for task in tasks))
            preflight = flow('/node/v1/status', 'OPTIONS')
            preflight.request.host = NODES[1]
            await asyncio.wait_for(addon.request(preflight), 1)
            self.assertIsNone(preflight.response)
        finally:
            addon.launch.holding = False
            addon.launch.release.set()
            await asyncio.gather(*tasks)
        self.assertTrue(all(request.response is None for request in requests))

    async def test_all_visual_modes_preserve_candidates_health_errors_and_preflights(self):
        for game, records in (('', False), ('texas-holdem', False), ('zhajinhua', False), ('', True)):
            with self.subTest(game=game, records=records):
                addon = proxy(game, records)
                # 忙碌的 Node 夹具服务不能阻塞这些请求，也不能参与决定健康结果。
                with patch.object(module.IosVisualProxy, 'fixture_response',
                        side_effect=AssertionError('选线请求必须直接访问上游')) as fixture:
                    for host in ('api.shafayouxi.org', *NODES):
                        for version in (12, 13):
                            for method in ('GET', 'POST', 'OPTIONS'):
                                for candidates in (NODES, NODES[1:]):
                                    servers = ({node: f'192.0.2.{i + 1}' for i, node in enumerate(candidates)}
                                               if version == 13 else list(candidates))
                                    await self.check_exchange(addon, host,
                                        f'/public/v{version}/metadata/servers?platform=ios', method,
                                        {'ok': True, 'extra': 42, 'result': {'servers': servers}})
                        for method in ('GET', 'OPTIONS'):
                            # 64 指标超限、连接失败；67 正常；第三台真实 503。
                            delay, status = (1065, 200) if host == NODES[0] else (
                                (37, 200) if host == NODES[1] else (0, 503))
                            await self.check_exchange(addon, host, '/node/v1/status', method,
                                {'backend_delay': delay, 'server_load': 'normal', 'unknown': True}, status)
                        for path in ('/node/v1/status', '/public/v13/metadata/servers',
                                     '/v2/centrifugo/connection/websocket'):
                            await self.check_exchange(addon, host, path, 'GET', b'<html>Bad Gateway</html>', 502)
                        failed = flow('/node/v1/status')
                        failed.request.host = host
                        await addon.request(failed)
                        self.assertIsNone(failed.response)
                        failed.error = Error('test-only connection failure')
                        addon.error(failed)
                        self.assertIsNone(failed.response)
                    fixture.assert_not_called()
                events = addon.transport.snapshot()['httpEvents']
                self.assertTrue(events)
                self.assertTrue(all(not event['mocked'] and event['source'] == 'upstream' for event in events))
                self.assertTrue(all(event['fixtureElapsedMs'] is None for event in events))
                health = [event for event in events if event['path'] == '/node/v1/status']
                self.assertTrue(any(event.get('backendDelay') == 1065 for event in health))
                self.assertTrue(any(event['host'] == NODES[1] and event.get('backendDelay') == 37 for event in health))
                self.assertTrue(any(event['status'] == 503 for event in health))
                self.assertTrue(any(event['status'] == 0 and event['transportError'] for event in health))

    async def check_exchange(self, addon, host, path, method, body, status=200):
        request = flow(path, method, {'platform': 'ios'} if method == 'POST' else None)
        request.request.host = host
        request.request.headers['Origin'] = 'https://app.test'
        request.request.headers['Access-Control-Request-Headers'] = 'authorization'
        original_request = request.request.get_state()
        await addon.request(request)
        self.assertIsNone(request.response, f'{host} {method} {path} must reach upstream')
        self.assertEqual(request.request.get_state(), original_request)
        request.response = http.Response.make(204 if method == 'OPTIONS' else status,
            b'' if method == 'OPTIONS' else body if isinstance(body, bytes) else json.dumps(body).encode(),
            {'Content-Type': 'application/json', 'ETag': 'upstream', 'X-Upstream': 'kept',
             'Access-Control-Allow-Origin': 'https://app.test', 'Access-Control-Allow-Headers': 'authorization'})
        if method != 'OPTIONS':
            request.response.encode('gzip')
        original_response = request.response.get_state()
        addon.response(request)
        self.assertEqual(request.response.get_state(), original_response)

    async def test_replay_targets_subscribed_room_across_nodes_and_keeps_rpc_isolation(self):
        for game, stream in (('texas-holdem', 'texas_holdem'), ('zhajinhua', 'zhajinhua')):
            with self.subTest(game=game):
                addon = proxy(game)
                replay = addon.game.texas if game == 'texas-holdem' else addon.game.replay
                sockets = []
                for index, host in enumerate(NODES):
                    connection = flow('/v2/centrifugo/connection/websocket')
                    connection.request.host = host
                    connection.websocket = websocket.WebSocketData()
                    addon.websocket_start(connection)
                    channel = f'{stream}>{OTHER if index == 2 else ROOM}#{USER}'
                    self.send(addon, connection, [{'id': 1, 'method': 1, 'params': {'channel': channel}}])
                    self.send(addon, connection, [{'id': 1, 'result': {}}], False)
                    sockets.append(connection)
                self.assertEqual([state['host'] for state in addon.transport.snapshot()['websocket']['connections']],
                                 list(NODES))
                payload = {'stream': stream, 'queue': []}
                with patch.object(module.ctx, 'master', create=True) as master:
                    replay.publish(ROOM, payload)
                    calls = master.commands.call.call_args_list
                    self.assertEqual([call.args[1] for call in calls], sockets[:2])
                    for call in calls:
                        self.assertEqual(call.args[0], 'inject.websocket')
                        self.assertIs(call.args[2], True)
                        self.assertEqual(json.loads(call.args[3])['result']['channel'], f'{stream}>{ROOM}#{USER}')
                    with self.assertRaises(ValueError):
                        replay.publish(OTHER, payload)
                    for connection in sockets[:2]:
                        master.reset_mock()
                        bet = {'id': 2, 'method': 9, 'params': {'data': {
                            'method': 'POST', 'path': f'/v10/{stream}/room/{ROOM}/game/test/call'}}}
                        other = {'id': 3, 'method': 9, 'params': {'data': {
                            'method': 'POST', 'path': f'/v10/{stream}/room/{OTHER}/game/test/call'}}}
                        message = self.send(addon, connection, [bet, other])
                        self.assertEqual(json.loads(message.content), other)
                        self.assertEqual(json.loads(master.commands.call.call_args.args[3])['id'], 2)
                    addon.websocket_end(sockets[0])
                    master.reset_mock()
                    replay.publish(ROOM, payload)
                    self.assertEqual([call.args[1] for call in master.commands.call.call_args_list], [sockets[1]])

    @staticmethod
    def send(addon, connection, frames, from_client=True):
        message = websocket.WebSocketMessage(Opcode.TEXT, from_client,
            '\n'.join(json.dumps(frame) for frame in frames).encode())
        connection.websocket.messages.append(message)
        addon.websocket_message(connection)
        return message
