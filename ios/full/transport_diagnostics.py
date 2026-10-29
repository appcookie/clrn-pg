"""只读传输计数；不保存头、查询参数、正文、关闭原因或会话身份。"""
from collections import Counter, OrderedDict
from datetime import datetime, timezone
import json
import math
import re
from time import monotonic
from urllib.parse import urlsplit
from matching_diagnostics import MatchingDiagnostics


class TransportDiagnostics:
    def __init__(self, clock=monotonic):
        self.requests = Counter()
        self.responses = Counter()
        self.failures = Counter()
        self.clock = clock
        self.sockets = {}
        self.socket_messages = Counter()
        self.socket_errors = Counter()
        self.socket_closes = Counter()
        self.http_events = OrderedDict()
        self.matching = MatchingDiagnostics(clock)

    @staticmethod
    def host(value):
        if isinstance(value, str) and (value == 'api.shafayouxi.org'
                or re.fullmatch(r'[a-zA-Z0-9.-]+\.api\.staging\.laiwan\.shafayouxi\.com', value)):
            return value
        return '<other>'

    @staticmethod
    def path(value):
        path = urlsplit(value).path
        if re.fullmatch(r'/v10/profile/[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', path):
            return '/v10/profile/<user>'
        return path if (re.fullmatch(r'/(?:node/)?v\d+/status', path)
            or re.fullmatch(r'/public/v\d+/metadata(?:/servers)?', path)
            or path == '/v2/centrifugo/connection/websocket') else None

    def socket_endpoint(self, flow):
        host, path = self.host(flow.request.host), self.path(flow.request.path)
        return (host, path) if host != '<other>' and path == '/v2/centrifugo/connection/websocket' else None

    def websocket_start(self, flow):
        endpoint = self.socket_endpoint(flow)
        if endpoint and flow.websocket and flow.id not in self.sockets:
            # The key stays internal so reconnects are distinct without
            # retaining the flow/body or exporting its identity.
            self.sockets[flow.id] = dict(endpoint=endpoint, opened=self.clock(), ended=None,
                lastActivity=None, clientToServer=None, serverToClient=None,
                connection=len(self.sockets) + 1)

    def websocket_message(self, flow):
        endpoint = self.socket_endpoint(flow)
        if not endpoint or not flow.websocket or not flow.websocket.messages:
            return
        state = self.sockets.get(flow.id)
        self.matching.websocket_message(flow, state['connection'] if state else None)
        message = flow.websocket.messages[-1]
        if message.injected:
            return
        direction = 'clientToServer' if message.from_client else 'serverToClient'
        self.socket_messages[(*endpoint, direction, 'text' if message.is_text else 'binary')] += 1
        state = self.sockets.get(flow.id)
        if state:
            state['lastActivity'] = state[direction] = self.clock()
        # Centrifugo JSON replies are newline-delimited. Inspect only protocol
        # error.code, never application result.data, channel, token or reason.
        if not message.is_text or len(message.content) > 256 * 1024:
            return
        for line in message.content.splitlines()[:1000]:
            try:
                frame = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(frame, dict) or not isinstance(frame.get('error'), dict):
                continue
            code = frame['error'].get('code')
            if type(code) is int and 0 <= code <= 65535:
                self.socket_errors[(*endpoint, direction, code)] += 1

    def websocket_end(self, flow):
        endpoint = self.socket_endpoint(flow)
        if not endpoint or not flow.websocket:
            return
        self.matching.websocket_end(flow)
        state = self.sockets.get(flow.id)
        if state and state['ended'] is not None:
            return
        if state:
            state['ended'] = self.clock()
        code = flow.websocket.close_code
        code = code if type(code) is int and 0 <= code <= 65535 else None
        initiator = ('client' if flow.websocket.closed_by_client is True else
                     'server' if flow.websocket.closed_by_client is False else 'unknown')
        if state:
            state['close'] = dict(code=code, initiator=initiator, transportError=bool(flow.error))
        self.socket_closes[(*endpoint, code, initiator, bool(flow.error))] += 1

    def request(self, flow):
        host, path = self.host(flow.request.host), self.path(flow.request.path)
        if host != '<other>':
            self.matching.http_request(flow)
        if host != '<other>' and path:
            self.requests[(host, path)] += 1
            method = flow.request.method
            self.http_events[flow.id] = dict(host=host, path=path,
                method=method if method in ('GET', 'POST', 'OPTIONS', 'HEAD') else '<other>',
                started=self.clock(), ended=None, status=None, mocked=False)
            while len(self.http_events) > 128:
                self.http_events.popitem(last=False)

    def fixture_started(self, flow):
        event = self.http_events.get(flow.id)
        if event is not None:
            event['fixtureStarted'] = self.clock()

    def fixture_finished(self, flow):
        event = self.http_events.get(flow.id)
        if event is not None:
            event['fixtureEnded'] = self.clock()

    @staticmethod
    def health(response):
        # Only the public health contract is inspected; never retain arbitrary
        # bodies, error descriptions, request headers, URLs or metadata servers.
        if not response or len(response.content or b'') > 4096:
            return {}
        try:
            body = response.json()
        except (ValueError, UnicodeDecodeError):
            return {}
        if not isinstance(body, dict):
            return {}
        result = {}
        load = body.get('server_load')
        if isinstance(load, str):
            result['serverLoad'] = load if load in ('normal', 'unavailable', 'busy', 'overload') else '<other>'
        delay = body.get('backend_delay')
        if type(delay) in (int, float) and math.isfinite(delay) and 0 <= delay <= 1_000_000_000:
            result['backendDelay'] = delay
        return result

    def response(self, flow):
        host, path = self.host(flow.request.host), self.path(flow.request.path)
        if host != '<other>':
            self.matching.http_response(flow)
        if host != '<other>' and path:
            self.responses[(host, path, flow.response.status_code if flow.response else 0)] += 1
            event = self.http_events.get(flow.id)
            if event is not None:
                event.update(ended=self.clock(), status=flow.response.status_code if flow.response else 0,
                    mocked=flow.metadata.get('ios_mocked') is True, transportError=bool(flow.error),
                    source='visual-node-exclusion' if flow.metadata.get('visual_node_excluded') is True
                        else 'fixture' if flow.metadata.get('ios_mocked') is True else 'upstream')
                if path == '/node/v1/status':
                    event.update(self.health(flow.response))
                elif path == '/v10/profile/<user>' and flow.response:
                    # 仅记录字段是否存在，不保留用户身份、头像地址、昵称或错误正文。
                    try:
                        body = flow.response.json() if len(flow.response.content or b'') <= 256 * 1024 else None
                    except (ValueError, UnicodeDecodeError):
                        body = None
                    result = body.get('result') if isinstance(body, dict) else None
                    event['profileShape'] = {
                        'ok': isinstance(body, dict) and body.get('ok') is True,
                        'resultObject': isinstance(result, dict),
                        'nicknamePresent': isinstance(result, dict) and isinstance(result.get('nickname'), str)
                            and bool(result['nickname']),
                        'avatarPresent': isinstance(result, dict) and isinstance(result.get('avatar_path'), str),
                    }

    def tls_failure(self, kind, data):
        client = getattr(data.context, 'client', None)
        server = getattr(data.context, 'server', None)
        address = getattr(server, 'address', None)
        host = getattr(client, 'sni', None) or (address[0] if address else None)
        self.failures[(kind, self.host(host))] += 1

    def snapshot(self):
        now = self.clock()
        ago = lambda value: round(max(0, now - value) * 1000) if value is not None else None
        return {
            'sampledAtUtc': datetime.now(timezone.utc).isoformat(),
            'matchingRpc': self.matching.snapshot(),
            'requests': [{'host': host, 'path': path, 'count': count}
                for (host, path), count in sorted(self.requests.items())],
            'responses': [{'host': host, 'path': path, 'status': status, 'count': count}
                for (host, path, status), count in sorted(self.responses.items())],
            'tlsFailures': [{'kind': kind, 'host': host, 'count': count}
                for (kind, host), count in sorted(self.failures.items())],
            'httpEvents': [{key: value for key, value in event.items()
                if key not in ('started', 'ended', 'fixtureStarted', 'fixtureEnded')} | {
                    'requestAgoMs': ago(event['started']), 'responseAgoMs': ago(event['ended']),
                    'elapsedMs': round((event['ended'] - event['started']) * 1000)
                        if event['ended'] is not None else None,
                    'fixtureElapsedMs': round((event['fixtureEnded'] - event['fixtureStarted']) * 1000)
                        if event.get('fixtureEnded') is not None else None}
                for event in self.http_events.values()],
            'websocket': {
                'opened': len(self.sockets),
                'connections': [{'host': state['endpoint'][0], 'path': state['endpoint'][1],
                    'connection': state['connection'],
                    'state': 'closed' if state['ended'] is not None else 'open',
                    'openedAgoMs': ago(state['opened']), 'closedAgoMs': ago(state['ended']),
                    # mitmproxy's message hook exposes data messages, not raw
                    # WebSocket Ping/Pong control frames. Do not claim those.
                    'lastDataMessageAgoMs': ago(state['lastActivity']),
                    'lastClientMessageAgoMs': ago(state['clientToServer']),
                    'lastServerMessageAgoMs': ago(state['serverToClient']),
                    'close': state.get('close')}
                    for state in self.sockets.values()],
                'messages': [{'host': host, 'path': path, 'direction': direction,
                    'type': kind, 'count': count}
                    for (host, path, direction, kind), count in sorted(self.socket_messages.items())],
                'protocolErrors': [{'host': host, 'path': path, 'direction': direction,
                    'code': code, 'count': count}
                    for (host, path, direction, code), count in sorted(self.socket_errors.items())],
                'closed': [{'host': host, 'path': path, 'code': code, 'initiator': initiator,
                    'transportError': failed, 'count': count}
                    for (host, path, code, initiator, failed), count in self.socket_closes.items()],
            },
        }
