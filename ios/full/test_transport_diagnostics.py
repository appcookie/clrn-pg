"""验证传输诊断保留请求状态和耗时，严格排除凭据、用户标识与业务正文。"""
import json
from types import SimpleNamespace
import unittest
from mitmproxy import http, websocket
from wsproto.frame_protocol import Opcode
from test_network_observer import flow
from transport_diagnostics import TransportDiagnostics


class TransportTests(unittest.TestCase):
    def test_profile_diagnostics_redact_identity_and_only_keep_response_shape(self):
        diagnostics = TransportDiagnostics()
        identifier = '12345678-1234-4234-8234-123456789abc'
        request = flow(f'/v10/profile/{identifier}?token=private-query')
        request.request.headers['Authorization'] = 'private-token'
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {
            'nickname': 'private-nickname', 'avatar_path': 'private-avatar',
            'created_at': 'private-date', 'token': 'private-body', 'user_id': identifier,
        }}).encode())
        diagnostics.request(request)
        diagnostics.response(request)
        snapshot = diagnostics.snapshot()
        self.assertEqual(snapshot['httpEvents'][0]['path'], '/v10/profile/<user>')
        self.assertEqual(snapshot['httpEvents'][0]['profileShape'], {
            'ok': True, 'resultObject': True, 'nicknamePresent': True, 'avatarPresent': True})
        serialized = json.dumps(snapshot)
        self.assertNotIn(identifier, serialized)
        self.assertNotIn('private-', serialized)
        request.response = http.Response.make(503, b'{"error":"private-error"}')
        diagnostics.response(request)
        self.assertFalse(diagnostics.snapshot()['httpEvents'][0]['profileShape']['ok'])

    def socket_flow(self, host='64.kr-seoul.api.staging.laiwan.shafayouxi.com'):
        result = flow('/v2/centrifugo/connection/websocket?token=private-token')
        result.id = 'private-flow-identity'
        result.request.host = host
        result.request.headers['Authorization'] = 'private-auth'
        result.response = http.Response.make(101)
        result.websocket = websocket.WebSocketData()
        return result

    @staticmethod
    def message(result, content, from_client=False, injected=False, binary=False):
        message = websocket.WebSocketMessage(Opcode.BINARY if binary else Opcode.TEXT,
            from_client, content, injected=injected)
        result.websocket.messages.append(message)
        return message

    def test_metadata_versions_and_health_status_are_counted_without_payload(self):
        diagnostics = TransportDiagnostics()
        request = flow('/public/v14/metadata/servers?token=private-secret')
        request.request.headers['Authorization'] = 'Bearer private-secret'
        request.response = http.Response.make(200, b'{"private":"secret"}')
        diagnostics.request(request)
        diagnostics.response(request)
        failed = flow('/node/v1/status?secret=hidden')
        failed.request.host = '67.kr-seoul.api.staging.laiwan.shafayouxi.com'
        failed.response = http.Response.make(503, b'private-server-body')
        diagnostics.request(failed)
        diagnostics.response(failed)
        diagnostics.request(flow('/v10/wallet/private-user-id', 'PUT', {'secret': 'hidden'}))
        diagnostics.request(flow('/public/v10/user/login/username/password', 'POST', {'password': 'hidden'}))
        result = diagnostics.snapshot()
        self.assertEqual(len(result['requests']), 2)
        self.assertIn({'host': failed.request.host, 'path': '/node/v1/status', 'status': 503, 'count': 1}, result['responses'])
        serialized = json.dumps(result)
        for sensitive in ('private', 'hidden', 'token=', 'password', 'Authorization'):
            self.assertNotIn(sensitive, serialized)

    def test_tls_failure_records_only_staging_host_and_kind(self):
        diagnostics = TransportDiagnostics()
        context = SimpleNamespace(client=SimpleNamespace(sni='64.kr-seoul.api.staging.laiwan.shafayouxi.com'),
                                  server=SimpleNamespace(address=('api.shafayouxi.org', 443)))
        diagnostics.tls_failure('client', SimpleNamespace(context=context, error='private-secret'))
        context.client.sni = 'secret-user.example.com'
        diagnostics.tls_failure('server', SimpleNamespace(context=context, error='private-secret'))
        result = diagnostics.snapshot()
        self.assertEqual(result['tlsFailures'][0]['kind'], 'client')
        self.assertEqual(result['tlsFailures'][1]['host'], '<other>')
        self.assertNotIn('private-secret', json.dumps(result))
        self.assertNotIn('secret-user', json.dumps(result))

    def test_real_websocket_lifecycle_counts_only_safe_protocol_metadata(self):
        now = [10.0]
        diagnostics = TransportDiagnostics(clock=lambda: now[0])
        request = self.socket_flow()
        diagnostics.request(request)
        diagnostics.response(request)
        diagnostics.websocket_start(request)
        diagnostics.websocket_start(request)
        now[0] = 11
        outgoing = self.message(request, b'{"method":1,"params":{"channel":"private-room-user"}}', True)
        diagnostics.websocket_message(request)
        now[0] = 12
        content = b'{"id":1,"error":{"code":109,"message":"private-token"}}\n{"result":{"data":{"error":{"code":987},"body":"private-body"}}}'
        incoming = self.message(request, content)
        diagnostics.websocket_message(request)
        injected = self.message(request, b'{"error":{"code":999}}', injected=True)
        diagnostics.websocket_message(request)
        now[0] = 13
        diagnostics.websocket_message(request)  # injected traffic cannot refresh last activity
        request.websocket.close_code = 1006
        request.websocket.closed_by_client = False
        request.websocket.close_reason = 'private-close-reason'
        diagnostics.websocket_end(request)
        diagnostics.websocket_end(request)
        now[0] = 15
        result = diagnostics.snapshot()
        self.assertEqual(result['responses'][0]['status'], 101)
        ws = result['websocket']
        self.assertEqual(ws['opened'], 1)
        self.assertEqual(sum(item['count'] for item in ws['messages']), 2)
        self.assertEqual([item['code'] for item in ws['protocolErrors']], [109])
        self.assertEqual(ws['closed'][0]['code'], 1006)
        self.assertEqual(ws['closed'][0]['initiator'], 'server')
        self.assertEqual(ws['closed'][0]['count'], 1)
        self.assertEqual(ws['connections'][0]['state'], 'closed')
        self.assertEqual(ws['connections'][0]['lastDataMessageAgoMs'], 3000)
        self.assertEqual(ws['connections'][0]['lastClientMessageAgoMs'], 4000)
        self.assertEqual(ws['connections'][0]['lastServerMessageAgoMs'], 3000)
        self.assertEqual(ws['connections'][0]['closedAgoMs'], 2000)
        self.assertEqual(ws['connections'][0]['close'],
            {'code': 1006, 'initiator': 'server', 'transportError': False})
        self.assertEqual(incoming.content, content)
        self.assertFalse(incoming.dropped)
        self.assertFalse(outgoing.dropped)
        self.assertTrue(injected.injected)
        for sensitive in ('private', 'token=', 'Authorization', '987', '999'):
            self.assertNotIn(sensitive, json.dumps(result))

    def test_other_endpoints_binary_invalid_json_and_unknown_close_are_safe(self):
        diagnostics = TransportDiagnostics()
        other = self.socket_flow('private-user.example.com')
        diagnostics.websocket_start(other)
        self.message(other, b'{"error":{"code":100}}')
        diagnostics.websocket_message(other)
        diagnostics.websocket_end(other)
        wrong_path = self.socket_flow()
        wrong_path.request.path = '/v2/private-user/websocket'
        diagnostics.websocket_start(wrong_path)
        request = self.socket_flow()
        diagnostics.websocket_start(request)
        for content, binary in [(b'\xffprivate-binary', True), (b'\xff', False),
                (b'{"error":{"code":"private-code"}}', False),
                (b'{"error":{"code":true}}', False),
                (b'{"error":{"code":100000000}}', False),
                (b'{"error":{"code":101}}' + b' ' * (256 * 1024), False)]:
            self.message(request, content, binary=binary)
            diagnostics.websocket_message(request)
        diagnostics.websocket_end(request)
        result = diagnostics.snapshot()['websocket']
        self.assertEqual(result['opened'], 1)
        self.assertEqual(sum(item['count'] for item in result['messages']), 6)
        self.assertEqual(result['protocolErrors'], [])
        self.assertIsNone(result['closed'][0]['code'])
        self.assertEqual(result['closed'][0]['initiator'], 'unknown')
        self.assertNotIn('private', json.dumps(result))

    def test_health_and_metadata_timeline_distinguishes_fixture_delay_pending_and_errors(self):
        now = [10.0]
        diagnostics = TransportDiagnostics(clock=lambda: now[0])
        status = flow('/node/v1/status?token=private-token')
        status.request.headers['Authorization'] = 'private-authorization'
        diagnostics.request(status)
        now[0] = 10.1
        diagnostics.fixture_started(status)
        now[0] = 12.6
        diagnostics.fixture_finished(status)
        now[0] = 13.2
        status.response = http.Response.make(200, json.dumps({'server_load': 'normal',
            'backend_delay': 327, 'private': 'private-body'}).encode())
        diagnostics.response(status)
        metadata = flow('/public/v12/metadata/servers?token=private-token', 'POST', {'private': 'body'})
        diagnostics.request(metadata)
        now[0] = 24.0
        metadata.response = http.Response.make(200, b'{"result":{"servers":["private-node"]}}')
        diagnostics.response(metadata)
        failed = flow('/node/v1/status')
        diagnostics.request(failed)
        now[0] = 25.0
        failed.error = SimpleNamespace(msg='private-transport-error')
        diagnostics.response(failed)
        pending = flow('/node/v1/status')
        diagnostics.request(pending)
        events = diagnostics.snapshot()['httpEvents']
        self.assertEqual(events[0]['elapsedMs'], 3200)
        self.assertEqual(events[0]['fixtureElapsedMs'], 2500)
        self.assertEqual(events[0]['serverLoad'], 'normal')
        self.assertEqual(events[0]['backendDelay'], 327)
        self.assertFalse(events[0]['mocked'])
        self.assertEqual(events[1]['elapsedMs'], 10800)
        self.assertEqual(events[1]['method'], 'POST')
        self.assertNotIn('serverLoad', events[1])
        self.assertEqual(events[2]['status'], 0)
        self.assertTrue(events[2]['transportError'])
        self.assertIsNone(events[3]['responseAgoMs'])
        self.assertIsNone(events[3]['elapsedMs'])
        for sensitive in ('private', 'token=', 'Authorization', status.id):
            self.assertNotIn(sensitive, json.dumps(diagnostics.snapshot()))

    def test_health_fields_are_strict_allowlisted_and_events_bounded(self):
        diagnostics = TransportDiagnostics()
        for value in [True, 'private-delay', float('nan'), float('inf'), -1, 1e20]:
            request = flow('/node/v1/status')
            diagnostics.request(request)
            request.metadata['ios_mocked'] = True
            request.response = http.Response.make(200,
                json.dumps({'server_load': 'private-load', 'backend_delay': value}).encode())
            diagnostics.response(request)
            event = diagnostics.snapshot()['httpEvents'][-1]
            self.assertEqual(event['serverLoad'], '<other>')
            self.assertNotIn('backendDelay', event)
            self.assertTrue(event['mocked'])
        for body in [b'not-json-private', b'[]', b'{"server_load":"normal"}' + b' ' * 4096]:
            self.assertEqual(diagnostics.health(http.Response.make(200, body)), {})
        for _ in range(130):
            diagnostics.request(flow('/node/v1/status'))
        self.assertEqual(len(diagnostics.snapshot()['httpEvents']), 128)
        self.assertNotIn('private', json.dumps(diagnostics.snapshot()))

    def test_reconnect_and_failed_upgrade_remain_distinguishable_without_flow_ids(self):
        diagnostics = TransportDiagnostics()
        first = self.socket_flow()
        diagnostics.websocket_start(first)
        diagnostics.websocket_end(first)
        second = self.socket_flow()
        second.id = 'private-second-connection'
        diagnostics.websocket_start(second)
        failed = self.socket_flow()
        failed.response = http.Response.make(503, b'private-server-error')
        diagnostics.request(failed)
        diagnostics.response(failed)
        result = diagnostics.snapshot()
        self.assertEqual(result['websocket']['opened'], 2)
        self.assertEqual([item['state'] for item in result['websocket']['connections']], ['closed', 'open'])
        self.assertEqual(result['responses'][0]['status'], 503)
        self.assertNotIn('private', json.dumps(result))
