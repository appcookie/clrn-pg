import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from mitmproxy import http
from mitmproxy import websocket
from wsproto.frame_protocol import Opcode
from test_network_observer import flow

with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    spec = importlib.util.spec_from_file_location('ios_proxy_addon', Path(__file__).with_name('proxy-addon.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_matching_http_observation_preserves_real_and_existing_fixture_responses(self):
        for mocked in (False, True):
            with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token',
                    'IOS_FUNCTIONAL': 'true', 'IOS_MATCHING': str(mocked).lower()}):
                addon = module.IosVisualProxy()
                request = flow('/v1/hall_matching/quit', 'POST', {'token': 'private-body'})
                original = request.request.content
                if mocked:
                    addon.functional = False
                await addon.request(request)
                if not mocked:
                    self.assertIsNone(request.response)
                    request.response = http.Response.make(503, b'{"ok":false,"error":"private-upstream"}')
                response = request.response.get_state()
                addon.response(request)
                self.assertEqual(request.request.content, original)
                self.assertEqual(request.response.get_state(), response)
                event = addon.transport.snapshot()['matchingRpc']['events'][-1]
                self.assertEqual(event['source'], 'proxy' if mocked else 'upstream')
                self.assertEqual(event['status'], 200 if mocked else 503)
                self.assertNotIn('private', json.dumps(addon.transport.snapshot()))

    async def test_matching_socket_observation_preserves_passthrough_and_labels_existing_injection(self):
        for mocked in (False, True):
            with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token',
                    'IOS_MATCHING': str(mocked).lower()}):
                addon = module.IosVisualProxy()
                target = flow('/v2/centrifugo/connection/websocket?token=private-query')
                target.websocket = websocket.WebSocketData()
                addon.websocket_start(target)
                content = json.dumps({'id': 723456, 'method': 9, 'params': {'data': {
                    'method': 'POST', 'path': '/v1/hall_matching/quit', 'body': 'private-body'}}}).encode()
                sent = websocket.WebSocketMessage(Opcode.TEXT, True, content)
                target.websocket.messages.append(sent)
                with patch.object(module, 'ctx') as context:
                    addon.websocket_message(target)
                    self.assertEqual(sent.dropped, mocked, '诊断不能更改既有夹具/透传行为')
                    self.assertEqual(sent.content, content)
                    self.assertEqual(context.master.commands.call.call_count, int(mocked))
                if not mocked:
                    reply = b'{"id":723456,"error":{"code":109,"message":"private-error"}}'
                    incoming = websocket.WebSocketMessage(Opcode.TEXT, False, reply)
                    target.websocket.messages.append(incoming)
                    addon.websocket_message(target)
                    self.assertEqual(incoming.content, reply)
                    self.assertFalse(incoming.dropped)
                result = addon.transport.snapshot()['matchingRpc']
                self.assertEqual(len(result['events']), 2)
                self.assertEqual(result['events'][-1]['source'], 'proxy' if mocked else 'upstream')
                self.assertEqual(result['events'][-1]['status'], 'injection-returned' if mocked else 'protocol-error')
                self.assertNotIn('private', json.dumps(result))

    async def test_native_selected_health_reaches_upstream_and_keeps_real_failures(self):
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token',
                'IOS_FUNCTIONAL': 'false', 'IOS_GAME': 'zhajinhua',
                'IOS_FIXTURE_URL': 'http://127.0.0.1:12345/', 'IOS_FIXTURE_TOKEN': 'fixture-token'}):
            addon = module.IosVisualProxy()
            # network-routes.test.mjs independently executes the real Node router
            # and proves it returns null for these routes after the bridge fix.
            with patch.object(module.IosVisualProxy, 'fixture_response',
                    side_effect=AssertionError('真实连接不能依赖繁忙的Node夹具服务')) as fixture:
                for path in ('/node/v1/status', '/public/v12/metadata/servers',
                        '/public/v13/metadata/servers', '/v2/centrifugo/connection/websocket'):
                    request = flow(path)
                    request.request.host = '64.kr-seoul.api.staging.laiwan.shafayouxi.com'
                    await addon.request(request)
                    self.assertIsNone(request.response, 'native bridge must leave upstream request intact')
                    request.response = http.Response.make(503, b'{"server_load":"unavailable"}')
                    addon.response(request)
                    self.assertEqual(request.response.status_code, 503)
                    self.assertEqual(request.response.content, b'{"server_load":"unavailable"}')
                fixture.assert_not_called()
            self.assertTrue(all(not item['mocked'] for item in addon.transport.snapshot()['httpEvents']))
            self.assertTrue(all(item['fixtureElapsedMs'] is None
                for item in addon.transport.snapshot()['httpEvents']))
            excluded = flow('/node/v1/status')
            await addon.request(excluded)
            self.assertEqual(excluded.response.status_code, 503)
            addon.response(excluded)
            event = addon.transport.snapshot()['httpEvents'][-1]
            self.assertTrue(event['mocked'])
            self.assertEqual(event['source'], 'visual-node-exclusion')

    async def test_native_error_hook_records_elapsed_without_response(self):
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token', 'IOS_FUNCTIONAL': 'true'}):
            addon = module.IosVisualProxy()
            now = [10.0]
            addon.transport = module.TransportDiagnostics(clock=lambda: now[0])
            request = flow('/public/v12/metadata/servers', 'POST')
            await addon.request(request)
            now[0] = 20.2
            from types import SimpleNamespace
            request.error = SimpleNamespace(msg='private-timeout-details')
            addon.error(request)
            event = addon.transport.snapshot()['httpEvents'][-1]
            self.assertEqual(event['elapsedMs'], 10200)
            self.assertEqual(event['status'], 0)
            self.assertTrue(event['transportError'])
            self.assertFalse(event['mocked'])
            self.assertNotIn('private', json.dumps(addon.transport.snapshot()))

    async def test_private_texas_creation_arms_only_self_statistics_after_real_login(self):
        user = '10000000-0000-0000-0000-000000000001'
        room = '20000000-0000-0000-0000-000000000001'
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token',
                'IOS_FUNCTIONAL': 'false', 'IOS_GAME': 'texas-holdem'}):
            addon = module.IosVisualProxy()
        self.assertIsNone(addon.game.view.mode)
        login = flow('/public/v10/user/login/username/password', 'POST', {})
        login.response = http.Response.make(200, json.dumps({'ok': True, 'result': {
            'user_id': user, 'username': 'test-only',
            'api_token': {'token_type': 'Bearer', 'access_token': 'test-token'}}}).encode())
        addon.response(login)
        created = flow('/v3/pay_action/do', 'POST', {'user_id': user,
            'action_url': {'method': 'POST', 'path': '/v2/building/$building_id$/room'},
            'action_json': {'game_type': 'texas_holdem'}})
        created.response = http.Response.make(200, json.dumps({'ok': True, 'result': {'room_id': room}}).encode())
        addon.response(created)
        self.assertEqual(addon.game.texas.statistics_owner, (room, user))
        self.assertIsNone(addon.game.texas.created_room_id)
        self.assertIsNone(addon.game.texas.room_id)
        # Ownership alone cannot mock reads before the matching real replay.
        path = f'/v1/texas_statistics/player/{user}/rounds/100'
        self.assertIsNone(addon.game.texas.http_fixture(path))
        addon.game.texas.room_id, addon.game.texas.self_id = room, user
        request = flow(path)
        addon.game.request(request)
        self.assertEqual(request.response.json()['result']['total_hands'], 100)
        addon.game.texas.release()
        # Subsequent HTTP responses cannot silently re-arm a released fixture.
        addon.response(login)
        self.assertIsNone(addon.game.texas.statistics_owner)

    async def test_functional_passes_real_business_and_blocks_registration(self):
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token', 'IOS_FUNCTIONAL': 'true'}):
            addon = module.IosVisualProxy()
            request = flow('/v10/wallet/user', 'PUT', {'currencies': ['coin']})
            await addon.request(request)
            self.assertIsNone(request.response)
            request.response = http.Response.make(200, b'{"ok":true,"result":{"coin":42}}')
            addon.response(request)
            self.assertEqual(addon.observer.events[-1]['body']['result']['coin'], 42)
            request = flow('/public/v11/user/register/username/password', 'POST', {'password': 'hidden'})
            await addon.request(request)
            self.assertEqual(request.response.status_code, 403)
            self.assertTrue(request.metadata['ios_mocked'])

    async def test_visual_fixture_uses_direct_opener_despite_system_proxy(self):
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token', 'IOS_FUNCTIONAL': 'false',
            'IOS_FIXTURE_URL': 'http://127.0.0.1:12345/', 'IOS_FIXTURE_TOKEN': 'fixture-token'}):
            addon = module.IosVisualProxy()
            request = flow('/public/v10/profile/country')
            with patch.object(module.IosVisualProxy, 'fixture_response', return_value={
                'status': 200, 'body': '{"ok":true}', 'contentType': 'application/json'}) as fixture:
                await addon.request(request)
                self.assertEqual(fixture.call_args[0][0].full_url, 'http://127.0.0.1:12345/')
                self.assertEqual(request.response.status_code, 200)
            with patch.object(module.urllib.request, 'ProxyHandler', wraps=module.urllib.request.ProxyHandler) as proxy:
                with patch.object(module.urllib.request, 'build_opener') as opener:
                    response = opener.return_value.open.return_value.__enter__.return_value
                    response.read.return_value = b'null'
                    self.assertIsNone(addon.fixture_response(module.urllib.request.Request('http://127.0.0.1:12345/')))
                    proxy.assert_called_once_with({})
            with self.assertRaises(ValueError):
                addon.fixture_response(module.urllib.request.Request('http://example.com/'))
