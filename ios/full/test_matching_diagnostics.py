"""无需设备/端口的观测回归；流量替身只用于本只读组件的单元测试。"""
import json
from types import SimpleNamespace
import unittest
from transport_diagnostics import TransportDiagnostics


HOST = '64.kr-seoul.api.staging.laiwan.shafayouxi.com'
JOIN = '/v1/hall_matching/join'
QUIT = '/v1/hall_matching/quit'


def flow(identity='private-flow', path='/v2/centrifugo/connection/websocket'):
    return SimpleNamespace(id=identity, metadata={}, error=None, response=None,
        request=SimpleNamespace(host=HOST, path=path, method='POST', content=b'private-body',
                                headers={'Authorization': 'private-token'}),
        websocket=SimpleNamespace(messages=[], close_code=3007, closed_by_client=False))


def message(target, frames, client=True, injected=False, text=True):
    content = frames if isinstance(frames, bytes) else b'\n'.join(json.dumps(item).encode() for item in frames)
    result = SimpleNamespace(content=content, from_client=client, injected=injected, is_text=text, dropped=False)
    target.websocket.messages.append(result)
    return result


def rpc(identifier, path):
    return {'id': identifier, 'method': 9, 'params': {'data': {
        'method': 'POST', 'path': path, 'body': {'token': 'private-rpc-body'}}}}


class MatchingTests(unittest.TestCase):
    def test_batched_real_rpc_correlates_replies_without_changing_or_exporting_payload(self):
        now = [10.0]
        diagnostics = TransportDiagnostics(clock=lambda: now[0])
        target = flow()
        diagnostics.websocket_start(target)
        sent = message(target, [rpc(723456, JOIN), rpc(723457, QUIT), rpc(723458, '/private-path')])
        original = sent.content
        diagnostics.websocket_message(target)
        now[0] = 12
        received = message(target, [
            {'id': 723457, 'result': {'data': {'ok': False, 'error': 'private-error'}}},
            {'id': 723456, 'result': {'data': {'ok': True, 'token': 'private-secret'}}},
            {'id': 723458, 'error': {'message': 'private-message'}}], client=False)
        received_original = received.content
        diagnostics.websocket_message(target)
        result = diagnostics.snapshot()['matchingRpc']
        self.assertEqual([item['sequence'] for item in result['events']], [1, 2, 2, 1])
        self.assertEqual([item['ok'] for item in result['events']], [None, None, False, True])
        self.assertEqual([item['agoMs'] for item in result['events']], [2000, 2000, 0, 0])
        self.assertEqual({item['connection'] for item in result['events']}, {1})
        self.assertEqual(result['events'][0]['rpcMethod'], 9)
        self.assertEqual(result['events'][0]['method'], 'POST')
        self.assertEqual(result['events'][-1]['source'], 'upstream')
        self.assertEqual(result['events'][-1]['direction'], 'serverToClient')
        self.assertEqual(sum(item['count'] for item in result['counts']), 4)
        self.assertEqual(result['pending'], [])
        self.assertEqual(sent.content, original)
        self.assertEqual(received.content, received_original)
        self.assertFalse(sent.dropped or received.dropped)
        for item in result['events'] + result['pending']:
            self.assertNotIn('id', item)
            self.assertNotIn('rpcId', item)
            self.assertNotIn('flowId', item)
        for sensitive in ('private', 'Authorization'):
            self.assertNotIn(sensitive, json.dumps(result))

    def test_disconnect_and_reused_ids_do_not_turn_missing_replies_into_success(self):
        diagnostics = TransportDiagnostics()
        first, second = flow('private-first'), flow('private-second')
        diagnostics.websocket_start(first)
        message(first, [rpc(50, QUIT)])
        diagnostics.websocket_message(first)
        self.assertEqual(len(diagnostics.snapshot()['matchingRpc']['pending']), 1)
        diagnostics.websocket_end(first)
        diagnostics.websocket_start(second)
        message(second, [{'id': 50, 'result': {'data': {'ok': True}}}], client=False)
        diagnostics.websocket_message(second)
        result = diagnostics.snapshot()['matchingRpc']
        self.assertEqual([item['phase'] for item in result['events']], ['request', 'incomplete'])
        self.assertEqual(result['events'][-1]['status'], 'connection-closed')
        message(second, [rpc(50, QUIT)])
        diagnostics.websocket_message(second)
        message(second, [{'id': 50, 'error': {'code': 109, 'message': 'private-reason'}}], client=False)
        diagnostics.websocket_message(second)
        result = diagnostics.snapshot()['matchingRpc']
        self.assertEqual(result['events'][-1]['status'], 'protocol-error')
        self.assertIsNone(result['events'][-1]['ok'])
        self.assertEqual(result['events'][-1]['connection'], 2)

    def test_proxy_injection_is_explicit_and_not_double_counted_as_upstream(self):
        diagnostics = TransportDiagnostics()
        target = flow()
        diagnostics.websocket_start(target)
        message(target, [rpc(51, JOIN)])
        diagnostics.websocket_message(target)
        replies = [{'id': 51, 'result': {'data': {'ok': True}}}]
        diagnostics.matching.proxy_replies(target, replies)
        message(target, replies, client=False, injected=True)
        diagnostics.websocket_message(target)
        result = diagnostics.snapshot()['matchingRpc']
        self.assertEqual(len(result['events']), 2)
        self.assertEqual(result['events'][-1]['source'], 'proxy')
        self.assertEqual(result['events'][-1]['status'], 'injection-returned')
        self.assertEqual(result['events'][-1]['direction'], 'proxyToClient')

    def test_http_upstream_mock_error_and_pending_are_distinct_and_redacted(self):
        diagnostics = TransportDiagnostics()
        for index, (mocked, status) in enumerate(((False, 200), (True, 200), (False, 503), (False, None))):
            target = flow(f'private-http-{index}', QUIT + '?token=private-query')
            diagnostics.request(target)
            target.metadata['ios_mocked'] = mocked
            if status:
                body = b'{"ok":false,"error":"private-error"}'
                target.response = SimpleNamespace(status_code=status, content=body,
                                                 json=lambda: json.loads(body))
            else:
                target.error = SimpleNamespace(msg='private-transport-error')
            diagnostics.response(target)
            self.assertEqual(target.request.content, b'private-body')
            if status:
                self.assertEqual(target.response.content, body)
        pending = flow('private-pending', JOIN)
        diagnostics.request(pending)
        result = diagnostics.snapshot()['matchingRpc']
        responses = [item for item in result['events'] if item['phase'] == 'response']
        self.assertEqual([item['source'] for item in responses], ['upstream', 'proxy', 'upstream', 'upstream'])
        self.assertEqual([item['status'] for item in responses], [200, 200, 503, 'transport-error'])
        self.assertEqual(len(result['pending']), 1)
        self.assertNotIn('private', json.dumps(result))

    def test_unrelated_invalid_binary_injected_and_oversized_frames_are_ignored(self):
        diagnostics = TransportDiagnostics()
        target = flow()
        diagnostics.websocket_start(target)
        for body, options in [(b'private-invalid', {}), (b'\xff', {}),
                ([rpc(True, JOIN)], {}), ([rpc(1, '/private-path')], {}),
                ([rpc(1, JOIN)], {'injected': True}), ([rpc(1, JOIN)], {'text': False}),
                (json.dumps(rpc(1, JOIN)).encode() + b' ' * (256 * 1024), {})]:
            message(target, body, **options)
            diagnostics.websocket_message(target)
        other = flow('private-other')
        other.request.host = 'private.example.com'
        message(other, [rpc(1, JOIN)])
        diagnostics.websocket_message(other)
        other.request.path = JOIN
        diagnostics.request(other)
        self.assertEqual(diagnostics.snapshot()['matchingRpc']['events'], [])

    def test_bounded_history_exposes_truncation_and_preserves_counts(self):
        diagnostics = TransportDiagnostics()
        target = flow()
        diagnostics.websocket_start(target)
        for identifier in range(300):
            message(target, [rpc(identifier, QUIT)])
            diagnostics.websocket_message(target)
        result = diagnostics.snapshot()['matchingRpc']
        self.assertEqual(len(result['events']), 256)
        self.assertEqual(len(result['pending']), 128)
        self.assertEqual(result['eventTotal'], 300)
        self.assertEqual(result['pendingEvicted'], 172)
        self.assertEqual(result['counts'][0]['count'], 300)


if __name__ == '__main__':
    unittest.main()
