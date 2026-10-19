"""暂缓启动健康检查，保留真实请求与应用自身超时，释放后继续访问原服务器。"""

import asyncio
import json
import os
import time
from urllib.parse import urlsplit
from mitmproxy import http


class LaunchNetwork:
    def __init__(self):
        self.holding = False
        self.requested = 0
        self.last_requested_at = 0
        self.release = asyncio.Event()
        self.release.set()

    async def request(self, flow):
        path = urlsplit(flow.request.path).path
        if flow.request.host == 'test-mitmproxy.invalid' and path == '/android/launch-network':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
                return True
            if flow.request.method == 'POST':
                settings = json.loads(flow.request.content)
                self.holding = settings.get('hold') is True
                if self.holding:
                    self.requested = 0
                    self.last_requested_at = 0
                    self.release.clear()
                else:
                    self.release.set()
            flow.response = http.Response.make(200, json.dumps({
                'holding': self.holding, 'requested': self.requested,
                'lastRequestedAt': self.last_requested_at,
            }).encode(), {'Content-Type': 'application/json'})
            return True
        if self.holding and path == '/node/v1/status' and flow.request.method == 'GET':
            self.requested += 1
            self.last_requested_at = round(time.time() * 1000)
            # 不伪造成功或修改应用的五秒超时；测试退出后应显式释放。
            try:
                await asyncio.wait_for(self.release.wait(), timeout=60)
            except asyncio.TimeoutError:
                self.holding = False
                self.release.set()
        return False
