"""仅内存的原生网络观测与精确故障接口；凭据不进入流量文件或诊断日志。"""
import json
import os
from collections import deque
from urllib.parse import urlsplit
from mitmproxy import http
from http_failure import outcome, utc_now

LOGIN = '/public/v10/user/login/username/password'


def parsed(content):
    try:
        return json.loads(content)
    except (ValueError, TypeError, UnicodeDecodeError):
        return None


def without_passwords(value):
    if isinstance(value, dict):
        return {key: without_passwords(item) for key, item in value.items()
                if not any(word in key.lower() for word in ('password', 'secret'))}
    if isinstance(value, list):
        return [without_passwords(item) for item in value]
    return value


class NetworkObserver:
    def __init__(self):
        self.sequence = 0
        self.events = deque(maxlen=1000)
        self.sessions = {}
        self.authorizations = {}
        self.rules = []
        self.room_creation_attempts = deque(maxlen=20)

    def request(self, flow):
        self.sequence += 1
        flow.metadata['ios_sequence'] = self.sequence
        flow.metadata['ios_request_body'] = without_passwords(parsed(flow.request.content))
        flow.metadata['ios_session'] = self.authorizations.get(flow.request.headers.get('Authorization', ''))
        if flow.request.method == 'POST' and urlsplit(flow.request.path).path == '/v3/pay_action/do':
            attempt = {'sequence': self.sequence, 'completed': False, 'status': None, 'ok': None,
                       'method': 'POST', 'path': '/v3/pay_action/do', 'requestAtUtc': utc_now()}
            flow.metadata['ios_room_creation_attempt'] = attempt
            self.room_creation_attempts.append(attempt)

    def response(self, flow):
        if 'ios_sequence' not in flow.metadata:
            return
        body = parsed(flow.response.content) if flow.response else None
        attempt = flow.metadata.get('ios_room_creation_attempt')
        if attempt is not None:
            attempt.update(completed=True, status=flow.response.status_code if flow.response else 0,
                           ok=isinstance(body, dict) and body.get('ok') is True,
                           completedAtUtc=utc_now(), **(flow.metadata.get('ios_http_outcome') or outcome(flow)))
        path = urlsplit(flow.request.path).path
        request_body = flow.metadata.get('ios_request_body')
        if path == LOGIN and flow.request.method == 'POST' and isinstance(body, dict) and body.get('ok') is True:
            result = body.get('result') or {}
            token = result.get('api_token') or {}
            if isinstance(result.get('user_id'), str) and token.get('access_token') and token.get('token_type'):
                device_id = request_body.get('device_id', '') if isinstance(request_body, dict) else ''
                key = f"{result['user_id']}:{device_id}"
                authorization = f"{token['token_type']} {token['access_token']}"
                self.sessions[key] = {'key': key, 'userId': result['user_id'],
                    'username': result.get('username'), 'deviceId': device_id, 'authorization': authorization,
                    'origin': f'{urlsplit(flow.request.pretty_url).scheme}://{flow.request.host}'}
                self.authorizations[authorization] = key
                flow.metadata['ios_session'] = key
        self.events.append({'sequence': flow.metadata['ios_sequence'], 'method': flow.request.method,
            'url': flow.request.pretty_url, 'path': path,
            'status': flow.response.status_code if flow.response else 0,
            'body': body, 'requestBody': request_body, 'session': flow.metadata.get('ios_session'),
            'mocked': flow.metadata.get('ios_mocked', False)})

    def override(self, flow):
        path = urlsplit(flow.request.path).path
        session = flow.metadata.get('ios_session')
        for rule in list(self.rules):
            if rule['method'] != flow.request.method or rule['path'] != path:
                continue
            if rule.get('session') and rule['session'] != session:
                continue
            rule['remaining'] -= 1
            if rule['remaining'] == 0:
                self.rules.remove(rule)
            flow.response = http.Response.make(rule['status'], json.dumps(rule['body']).encode(),
                {'Content-Type': 'application/json'})
            return True
        return False

    def control(self, flow):
        path = urlsplit(flow.request.path).path
        if flow.request.host != 'test-mitmproxy.invalid' or not path.startswith('/native/observer/'):
            return False
        if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
            flow.response = http.Response.make(403, b'Forbidden')
            return True
        endpoint = path.rsplit('/', 1)[-1]
        data = parsed(flow.request.content) or {}
        status = 200
        if endpoint == 'mark':
            result = {'sequence': self.sequence}
        elif endpoint == 'events':
            after = data.get('after', 0)
            if not isinstance(after, int) or after < 0:
                status, result = 400, {'error': 'Invalid cursor'}
            else:
                result = {'events': [event for event in self.events if event['sequence'] > after],
                    'sequence': self.sequence}
        elif endpoint == 'sessions':
            result = {'sessions': list(self.sessions.values())}
        elif endpoint == 'room-creation':
            after = data.get('after', 0)
            if not isinstance(after, int) or after < 0:
                status, result = 400, {'error': 'Invalid cursor'}
            else:
                result = {'attempts': [item for item in self.room_creation_attempts
                                       if item['sequence'] > after]}
        elif endpoint == 'respond':
            if (data.get('method') not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
                    or not isinstance(data.get('path'), str) or not data['path'].startswith('/')
                    or not isinstance(data.get('status'), int) or not 100 <= data['status'] <= 599
                    or not isinstance(data.get('times', 1), int) or not 1 <= data.get('times', 1) <= 100
                    or 'body' not in data):
                status, result = 400, {'error': 'Invalid response rule'}
            else:
                self.rules.append({**data, 'remaining': data.get('times', 1)})
                result = {'rules': len(self.rules)}
        elif endpoint == 'clear-rules':
            self.rules.clear()
            result = {'ok': True}
        elif endpoint == 'clear':
            self.events.clear()
            result = {'sequence': self.sequence}
        elif endpoint == 'reset':
            self.done()
            result = {'sequence': self.sequence}
        else:
            status, result = 404, {'error': 'Unknown observer command'}
        flow.response = http.Response.make(status, json.dumps(result).encode(), {'Content-Type': 'application/json'})
        return True

    def done(self):
        self.events.clear()
        self.sessions.clear()
        self.authorizations.clear()
        self.rules.clear()
        self.room_creation_attempts.clear()
