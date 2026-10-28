"""匹配 RPC 的只读白名单观测；关联号仅在内存中使用，不导出业务 ID 或正文。"""
from collections import Counter, OrderedDict, deque
from datetime import datetime, timezone
import json
from time import monotonic
from urllib.parse import urlsplit


PATHS = frozenset(f'/v1/hall_matching/{action}' for action in ('join', 'quit', 'keep_waiting'))
METHODS = ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD')


class MatchingDiagnostics:
    def __init__(self, clock=monotonic):
        self.clock = clock
        self.sequence = 0
        self.event_total = 0
        self.pending_evicted = 0
        self.requests = OrderedDict()
        self.events = deque(maxlen=256)
        self.counts = Counter()

    @staticmethod
    def frames(message):
        if not message.is_text or len(message.content) > 256 * 1024:
            return []
        result = []
        for line in message.content.splitlines()[:1000]:
            try:
                frame = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(frame, dict):
                result.append(frame)
        return result

    @staticmethod
    def status(frame):
        # 仅保留协议状态和严格布尔业务状态，不输出 code/message/result。
        if isinstance(frame.get('error'), dict):
            return 'protocol-error', None
        result = frame.get('result')
        data = result.get('data') if isinstance(result, dict) else None
        ok = data.get('ok') if isinstance(data, dict) else None
        return ('reply' if isinstance(result, dict) else 'unrecognized'), ok if type(ok) is bool else None

    def event(self, request, phase, direction, source, status, ok=None):
        self.event_total += 1
        self.events.append({**request, 'phase': phase, 'direction': direction,
            'source': source, 'status': status, 'ok': ok,
            'atUtc': datetime.now(timezone.utc).isoformat(), 'at': self.clock()})
        self.counts[(request['transport'], request['path'], request['method'], phase, direction, source, status)] += 1

    def start(self, key, path, method, transport, host, connection=None):
        self.sequence += 1
        request = dict(sequence=self.sequence, path=path, method=method, transport=transport,
                       host=host, connection=connection)
        if transport == 'websocket':
            request['rpcMethod'] = 9
        self.requests[key] = request
        while len(self.requests) > 128:
            self.requests.popitem(last=False)
            self.pending_evicted += 1
        self.event(request, 'request', 'clientToProxy', 'client', 'observed')

    def finish(self, key, source, status, ok=None):
        request = self.requests.pop(key, None)
        if request:
            self.event(request, 'response', 'proxyToClient' if source == 'proxy' else 'serverToClient',
                       source, status, ok)

    def http_request(self, flow):
        path = urlsplit(flow.request.path).path
        if path in PATHS:
            method = flow.request.method
            self.start((flow.id, None), path,
                       method if method in METHODS else '<other>',
                       'http', flow.request.host)

    def http_response(self, flow):
        key = (flow.id, None)
        if key not in self.requests:
            return
        ok = None
        if flow.response and len(flow.response.content or b'') <= 256 * 1024:
            try:
                body = flow.response.json()
                value = body.get('ok') if isinstance(body, dict) else None
                ok = value if type(value) is bool else None
            except (ValueError, UnicodeDecodeError):
                pass
        self.finish(key, 'proxy' if flow.metadata.get('ios_mocked') is True else 'upstream',
                    flow.response.status_code if flow.response else 'transport-error', ok)

    def websocket_message(self, flow, connection=None):
        if not flow.websocket or not flow.websocket.messages:
            return
        message = flow.websocket.messages[-1]
        # 注入回执由实际注入调用单独登记，不能计作真实上游响应或重复统计。
        if message.injected:
            return
        for frame in self.frames(message):
            rpc_id = frame.get('id')
            if type(rpc_id) is not int or rpc_id < 0:
                continue
            if message.from_client:
                params = frame.get('params')
                data = params.get('data') if isinstance(params, dict) else None
                path = data.get('path') if isinstance(data, dict) else None
                if type(frame.get('method')) is int and frame['method'] == 9 and isinstance(path, str) and path in PATHS:
                    method = data.get('method')
                    self.start((flow.id, rpc_id), path, method if method in METHODS else '<other>',
                               'websocket', flow.request.host, connection)
            else:
                status, ok = self.status(frame)
                self.finish((flow.id, rpc_id), 'upstream', status, ok)

    def proxy_replies(self, flow, replies):
        for frame in replies:
            # 表示 inject.websocket 已返回；并不证明应用收到或执行回调。
            _, ok = self.status(frame)
            self.finish((flow.id, frame['id']), 'proxy', 'injection-returned', ok)

    def websocket_end(self, flow):
        for key in list(self.requests):
            if key[0] == flow.id and key[1] is not None:
                request = self.requests.pop(key)
                self.event(request, 'incomplete', 'unknown', 'unknown', 'connection-closed')

    def snapshot(self):
        now = self.clock()
        return {
            'events': [{key: value for key, value in event.items() if key != 'at'} | {
                'agoMs': round(max(0, now - event['at']) * 1000)} for event in self.events],
            'counts': [dict(transport=transport, path=path, method=method, phase=phase,
                           direction=direction, source=source, status=status, count=count)
                       for (transport, path, method, phase, direction, source, status), count in self.counts.items()],
            'pending': list(self.requests.values()),
            'eventTotal': self.event_total, 'pendingEvicted': self.pending_evicted,
            'limits': {'events': 256, 'pending': 128},
        }
