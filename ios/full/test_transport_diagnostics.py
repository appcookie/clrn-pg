import json
from types import SimpleNamespace
import unittest
from mitmproxy import http
from test_network_observer import flow
from transport_diagnostics import TransportDiagnostics


class TransportTests(unittest.TestCase):
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
