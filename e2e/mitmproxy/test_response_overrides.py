"""验证真实响应的未知字段、压缩、错误和契约变化都不会被 mock 掩盖。"""

import json
import unittest
from mitmproxy import http
from response_overrides import PROXY_HOST, METADATA_PATH, VisualNetwork, prepare_profiles, patch_profiles, patch_version
from test_network_faults import flow


class ResponseOverrideTests(unittest.TestCase):
    def metadata(self, body, status=200, method='GET', host='api.shafayouxi.org'):
        request = flow(f'https://{host}{METADATA_PATH}', method)
        request.response = http.Response.make(status, json.dumps(body).encode(), {
            'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://app.test',
            'X-Upstream': 'kept', 'ETag': 'old',
        })
        return request

    def test_metadata_only_filters_servers_and_preserves_compression_headers_and_unknown_fields(self):
        original = {'ok': True, 'trace': 'new-trace', 'result': {'extra': {'new': True},
            'servers': {PROXY_HOST: 'real-ip', 'other': 'another-ip'}}}
        request = self.metadata(original)
        request.response.encode('gzip')
        self.assertTrue(VisualNetwork().response(request))
        original['result']['servers'].pop('other')
        self.assertEqual(request.response.json(), original)
        self.assertEqual(request.response.headers['Content-Encoding'], 'gzip')
        self.assertEqual(request.response.headers['X-Upstream'], 'kept')
        self.assertEqual(request.response.headers['Access-Control-Allow-Origin'], 'https://app.test')
        self.assertNotIn('ETag', request.response.headers)
        self.assertEqual(int(request.response.headers['Content-Length']), len(request.response.raw_content))

    def test_metadata_errors_or_contract_changes_preserve_original_bytes(self):
        for body, status in (({'ok': False, 'error': 'auth'}, 200), ({'ok': True}, 503),
                             ({'ok': True, 'result': []}, 200),
                             ({'ok': True, 'result': {'servers': {}}}, 200),
                             ({'ok': True, 'result': {'servers': []}}, 200)):
            request = self.metadata(body, status)
            original = request.response.raw_content
            self.assertFalse(VisualNetwork().response(request))
            self.assertEqual(request.response.raw_content, original)
            self.assertEqual(request.response.status_code, status)
            self.assertEqual(request.response.headers['ETag'], 'old')
        request.response.content = b'<html>Bad Gateway</html>'
        self.assertFalse(VisualNetwork().response(request))
        self.assertEqual(request.response.content, b'<html>Bad Gateway</html>')

    def test_network_overrides_are_staging_only_and_read_only(self):
        network = VisualNetwork()
        body = {'ok': True, 'result': {'servers': {PROXY_HOST: 'ip', 'other': 'ip2'}}}
        for method in ('POST', 'PUT', 'DELETE'):
            self.assertFalse(network.response(self.metadata(body, method=method)))
            self.assertFalse(network.request(flow('https://offline.api.staging.laiwan.shafayouxi.com/node/v1/status', method)))
        for host in ('production.example.com', 'api.staging.laiwan.shafayouxi.com.evil.test'):
            self.assertFalse(network.response(self.metadata(body, host=host)))
            self.assertFalse(network.request(flow(f'https://{host}/node/v1/status')))

    def test_version_keeps_new_fields_and_does_not_recreate_removed_fields(self):
        request = self.metadata({'ok': True, 'result': {'available_url_version': 'v1', 'new': 42}})
        self.assertTrue(patch_version(request, 'v11'))
        self.assertEqual(request.response.json()['result'], {'available_url_version': 'v11', 'new': 42})
        for result in ({'new_version_field': 'v12'}, {'available_url_version': ['v12']}):
            request = self.metadata({'ok': True, 'result': result})
            original = request.response.content
            self.assertFalse(patch_version(request, 'v11'))
            self.assertEqual(request.response.content, original)

    def test_mixed_profiles_keep_current_account_real_and_only_add_requested_virtual_players(self):
        profiles = {'virtual': {'nickname': 'Opponent'}, 'unrequested': {'nickname': 'Other'}}
        request = flow('https://api.shafayouxi.org/v10/profile/users', 'PUT',
                       b'{"users":["self","virtual"]}')
        real = {'nickname': 'Real name', 'user_level': {'new': 12}, 'new_field': 42}
        request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {'self': real,
            'virtual': {'new_field': 'preserved'}}}).encode())
        self.assertTrue(prepare_profiles(request, 'self', profiles))
        self.assertEqual(request.request.json(), {'users': ['self']})
        self.assertTrue(patch_profiles(request, 'self', profiles))
        self.assertEqual(request.response.json()['result'], {'self': real,
            'virtual': {'new_field': 'preserved', 'nickname': 'Opponent'}})
        for content in (b'{"users":["self","unknown","virtual"]}', b'{"users":["self"]}', b'[]', b'{'):
            request.metadata.clear()
            request.request.content = content
            original = request.response.content
            self.assertFalse(prepare_profiles(request, 'self', profiles))
            self.assertEqual(request.request.content, content)
            self.assertFalse(patch_profiles(request, 'self', profiles))
            self.assertEqual(request.response.content, original)


if __name__ == '__main__':
    unittest.main()
