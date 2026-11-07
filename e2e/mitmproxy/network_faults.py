"""只在明确的 staging 故障场景注入异常；正常视觉场景保持真实选线。"""

import asyncio
import json
import os
from urllib.parse import parse_qs, urlsplit

from mitmproxy import http
from response_overrides import is_staging as is_staging_api

CONTROL_HOST = "test-mitmproxy.invalid"
FAULT_PATHS = {
    "hall-timeout": "/public/v1/hall_matching/available.json",
    "login-failure": "/public/v10/user/login/username/password",
    "club-failure": "/v10/club",
}
SCENARIOS = (None, *FAULT_PATHS, "visual-stable")


def json_response(flow, payload, status=200):
    return http.Response.make(
        status,
        json.dumps(payload).encode(),
        {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": flow.request.headers.get("Origin", "*"),
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        },
    )


class NetworkFaults:
    def __init__(self):
        self.token = os.environ["MITMPROXY_CONTROL_TOKEN"]
        self.scenario = None
        self.intercepted_requests = 0
        self.proxied_requests = 0
        self.stabilized_requests = 0

    def control(self, flow):
        if flow.request.headers.get("X-E2E-Control-Token") != self.token:
            flow.response = http.Response.make(403, b"Forbidden")
            return
        self.control_authorized(flow)

    def control_authorized(self, flow):
        route = (flow.request.method, urlsplit(flow.request.path).path)
        handler = {('POST', '/scenario'): self.configure_scenario,
                   ('GET', '/status'): self.status}.get(route)
        if handler is None:
            flow.response = http.Response.make(404, b"Not found")
            return
        handler(flow)

    def configure_scenario(self, flow):
        try:
            scenario = json.loads(flow.request.content)["scenario"]
            if scenario not in SCENARIOS:
                raise ValueError("Unknown scenario")
        except (ValueError, KeyError, TypeError):
            flow.response = http.Response.make(400, b"Invalid scenario")
            return
        self.set_scenario(scenario)
        self.status(flow)

    def set_scenario(self, scenario):
        self.scenario = scenario
        if scenario is not None:
            self.intercepted_requests = 0

    def status(self, flow):
        flow.response = json_response(flow, {
            "scenario": self.scenario,
            "interceptedRequests": self.intercepted_requests,
            "proxiedRequests": self.proxied_requests,
            "stabilizedRequests": self.stabilized_requests,
        })

    def mock_existing_username(self, flow, path):
        if self.scenario != "login-failure" or path != "/public/v10/user/username/is_existed":
            return False
        # 保留用户名已存在的分支，避免测试账号缺失时自动注册。
        flow.response = json_response(flow, {"ok": True, "result": {"is_existed": True}})
        return True

    def matches_fault(self, url):
        if url.path != FAULT_PATHS.get(self.scenario):
            return False
        if self.scenario == "club-failure":
            return "user_id" in parse_qs(url.query, keep_blank_values=True)
        return True

    async def request(self, flow: http.HTTPFlow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        url = urlsplit(flow.request.path)
        if not self.should_inject(flow, url):
            return
        await self.inject_fault(flow)

    async def inject_fault(self, flow):
        self.intercepted_requests += 1
        await self.delay_first_hall_request()
        if flow.killable:
            flow.kill()

    def is_fault_candidate(self, flow):
        # 故障注入放行 CORS 预检和非 staging 流量。
        return flow.request.method != "OPTIONS" and is_staging_api(flow.request.host)

    def should_inject(self, flow, url):
        if not self.is_fault_candidate(flow):
            return False
        return not self.mock_existing_username(flow, url.path) and self.matches_fault(url)

    async def delay_first_hall_request(self):
        if self.scenario == "hall-timeout" and self.intercepted_requests == 1:
            # 异步延迟保证其他请求和控制接口仍可响应。
            await asyncio.sleep(12)


addons = [NetworkFaults()]
