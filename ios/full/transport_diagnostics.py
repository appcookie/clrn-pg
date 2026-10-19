"""仅统计初始化端点和 TLS 失败；不保存头、查询参数、正文或会话。"""
from collections import Counter
import re
from urllib.parse import urlsplit


class TransportDiagnostics:
    def __init__(self):
        self.requests = Counter()
        self.responses = Counter()
        self.failures = Counter()

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
            or re.fullmatch(r'/public/v\d+/metadata(?:/servers)?', path)) else None

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
        return {
            'requests': [{'host': host, 'path': path, 'count': count}
                for (host, path), count in sorted(self.requests.items())],
            'responses': [{'host': host, 'path': path, 'status': status, 'count': count}
                for (host, path, status), count in sorted(self.responses.items())],
            'tlsFailures': [{'kind': kind, 'host': host, 'count': count}
                for (kind, host), count in sorted(self.failures.items())],
        }
