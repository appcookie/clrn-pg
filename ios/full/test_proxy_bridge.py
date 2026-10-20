import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from mitmproxy import http
from test_network_observer import flow

with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    spec = importlib.util.spec_from_file_location('ios_proxy_addon', Path(__file__).with_name('proxy-addon.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


class BridgeTests(unittest.IsolatedAsyncioTestCase):
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
