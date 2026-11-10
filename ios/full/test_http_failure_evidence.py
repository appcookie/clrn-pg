"""未知传输错误只补充固定签名，不记录服务端错误正文。"""
import json
import unittest
from unittest.mock import patch
from mitmproxy.flow import Error
from test_network_observer import flow
from transport_diagnostics import TransportDiagnostics


class UnknownEvidenceTests(unittest.TestCase):
    def test_unknown_signatures_preserve_original_failure_and_redact_content(self):
        for message, signature, reset in [
                ('stream reset by client (CANCEL)', 'http2-stream-reset', False),
                ('HTTP/2 connection closed: private-frame-data', 'http2-connection-closed', False),
                ('peer closed connection', 'peer-closed', False),
                ('connection cancelled', 'connection-cancelled', False),
                ('[Errno 54] private-peer-address', 'unrecognized', True),
                ('private-body mentions stream reset by client (CANCEL)', 'unrecognized', False)]:
            with self.subTest(signature=signature, reset=reset):
                request = flow('/v3/pay_action/do', 'POST', {'secret': 'private'})
                request.error = Error(message)
                original = request.get_state()
                diagnostics = TransportDiagnostics()
                diagnostics.request(request)
                diagnostics.response(request, hook='error')
                event = diagnostics.snapshot()['httpEvents'][0]
                self.assertEqual(event['failureCategory'], 'unknown')
                self.assertEqual(event['status'], 0)
                self.assertEqual(event['unknownErrorSignature'], signature)
                self.assertEqual(event['connectionReset'], reset)
                self.assertNotIn('private', json.dumps(diagnostics.snapshot()))
                current = request.get_state()
                current['metadata'] = original['metadata']
                self.assertEqual(current, original)

    def test_diagnostic_error_keeps_original_transport_failure(self):
        request = flow('/v3/pay_action/do', 'POST')
        request.error = Error('private-original')
        diagnostics = TransportDiagnostics()
        diagnostics.request(request)
        with patch('http_failure.unknown_signature', side_effect=RuntimeError('private-diagnostic')):
            diagnostics.response(request, hook='error')
        event = diagnostics.snapshot()['httpEvents'][0]
        self.assertEqual(event['failureCategory'], 'unknown')
        self.assertEqual(event['status'], 0)
        self.assertEqual(request.error.msg, 'private-original')
        self.assertNotIn('unknownErrorSignature', event)
