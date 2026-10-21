"""只读传输计数；不保存头、查询参数、正文、关闭原因或会话身份。"""
from collections import Counter
import json
import re
from time import monotonic
from urllib.parse import urlsplit


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

    @staticmethod
    def host(value):
        if isinstance(value, str) and (value == 'api.shafayouxi.org'
                or re.fullmatch(r'[a-zA-Z0-9.-]+\.api\.staging\.laiwan\.shafayouxi\.com', value)):
            return value
        return '<other>'

    @staticmethod
    def path(value):
        path = urlsplit(value).path
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
                lastActivity=None, clientToServer=None, serverToClient=None)

    def websocket_message(self, flow):
        endpoint = self.socket_endpoint(flow)
        if not endpoint or not flow.websocket or not flow.websocket.messages:
            return
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
        state = self.sockets.get(flow.id)
        if state and state['ended'] is not None:
            return
        if state:
            state['ended'] = self.clock()
        code = flow.websocket.close_code
        code = code if type(code) is int and 0 <= code <= 65535 else None
        initiator = ('client' if flow.websocket.closed_by_client is True else
                     'server' if flow.websocket.closed_by_client is False else 'unknown')
        self.socket_closes[(*endpoint, code, initiator, bool(flow.error))] += 1

    def request(self, flow):
        host, path = self.host(flow.request.host), self.path(flow.request.path)
        if host != '<other>' and path:
            self.requests[(host, path)] += 1

    def response(self, flow):
        host, path = self.host(flow.request.host), self.path(flow.request.path)
        if host != '<other>' and path:
            self.responses[(host, path, flow.response.status_code if flow.response else 0)] += 1

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
            'requests': [{'host': host, 'path': path, 'count': count}
                for (host, path), count in sorted(self.requests.items())],
            'responses': [{'host': host, 'path': path, 'status': status, 'count': count}
                for (host, path, status), count in sorted(self.responses.items())],
            'tlsFailures': [{'kind': kind, 'host': host, 'count': count}
                for (kind, host), count in sorted(self.failures.items())],
            'websocket': {
                'opened': len(self.sockets),
                'connections': [{'host': state['endpoint'][0], 'path': state['endpoint'][1],
                    'state': 'closed' if state['ended'] is not None else 'open',
                    'openedAgoMs': ago(state['opened']), 'closedAgoMs': ago(state['ended']),
                    # mitmproxy's message hook exposes data messages, not raw
                    # WebSocket Ping/Pong control frames. Do not claim those.
                    'lastDataMessageAgoMs': ago(state['lastActivity']),
                    'lastClientMessageAgoMs': ago(state['clientToServer']),
                    'lastServerMessageAgoMs': ago(state['serverToClient'])}
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
