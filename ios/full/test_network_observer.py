import json
import os
import unittest
from unittest.mock import patch
from mitmproxy import connection, http
from network_observer import NetworkObserver


def flow(path, method='GET', body=None, authorization=None):
    request = http.HTTPFlow(connection.Client(peername=('127.0.0.1', 1), sockname=('127.0.0.1', 2)),
        connection.Server(address=('api.shafayouxi.org', 443)))
    request.request = http.Request.make(method, 'https://api.shafayouxi.org' + path,
        b'' if body is None else json.dumps(body).encode())
    if authorization:
        request.request.headers['Authorization'] = authorization
    return request


class ObserverTests(unittest.TestCase):
    def test_multiple_sessions_are_retained_and_requests_hide_password(self):
        observer = NetworkObserver()
        for device in ['one', 'two']:
            request = flow('/public/v10/user/login/username/password', 'POST',
                {'username': 'tester' + device, 'password': 'private-password', 'device_id': device})
            observer.request(request)
            request.response = http.Response.make(200, json.dumps({'ok': True, 'result': {
                'user_id': 'user-' + device, 'username': 'tester' + device,
                'api_token': {'token_type': 'Bearer', 'access_token': 'token-' + device}}}).encode())
            observer.response(request)
        self.assertEqual(len(observer.sessions), 2)
        self.assertNotIn('password', observer.events[0]['requestBody'])
        self.assertEqual(observer.sessions['user-one:one']['origin'], 'https://api.shafayouxi.org')
        request = flow('/v10/wallet/user-one', 'PUT', {}, 'Bearer token-one')
        observer.request(request)
        request.response = http.Response.make(200, b'{"ok":true,"result":{"coin":100}}')
        observer.response(request)
        self.assertEqual(observer.events[-1]['session'], 'user-one:one')
        self.assertFalse(observer.events[-1]['mocked'])
        observer.done()
        self.assertFalse(observer.sessions)
        self.assertFalse(observer.events)
        self.assertFalse(observer.authorizations)

    def test_rules_are_exact_counted_and_session_scoped(self):
        observer = NetworkObserver()
        observer.authorizations['Bearer one'] = 'one'
        observer.authorizations['Bearer two'] = 'two'
        observer.rules = [{'method': 'GET', 'path': '/v10/club', 'status': 503,
                           'body': {'ok': False}, 'session': 'one', 'remaining': 1}]
        request = flow('/v10/club', authorization='Bearer two')
        observer.request(request)
        self.assertFalse(observer.override(request))
        request = flow('/v10/club', authorization='Bearer one')
        observer.request(request)
        self.assertTrue(observer.override(request))
        self.assertEqual(request.response.status_code, 503)
        self.assertFalse(observer.rules)
        self.assertFalse(observer.override(flow('/v10/club')))

    def test_control_auth_cursor_and_clear(self):
        observer = NetworkObserver()
        with patch.dict(os.environ, {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            request = flow('/native/observer/mark')
            request.request.host = 'test-mitmproxy.invalid'
            self.assertTrue(observer.control(request))
            self.assertEqual(request.response.status_code, 403)
            request.request.headers['X-E2E-Control-Token'] = 'test-token'
            observer.control(request)
            self.assertEqual(request.response.json(), {'sequence': 0})
            request.request.path = '/native/observer/respond'
            request.request.content = b'{"method":"GET","path":"/one","status":200,"body":{},"times":0}'
            observer.control(request)
            self.assertEqual(request.response.status_code, 400)
