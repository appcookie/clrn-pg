"""仅为俱乐部房间有数据截图提供固定业务响应，并保留独立代理的选址稳定化。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from mitmproxy import http

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import VisualNetwork, is_staging  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'
CLUB_IDENTIFIER = '00000000-0000-4000-8000-000000000151'
CLUB_NAME = '演示俱乐部'
CLUB_ROOMS = [
    {
        'room_id': 'visual-club-room-one', 'room_name': '德州体验局',
        'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-club-owner',
        'building_id': CLUB_IDENTIFIER, 'building_type': 'club', 'game_type': 'texas_holdem',
        'room_status': 'opening', 'timer_status': 'wait_for_timing',
        'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 2,
        'options': {
            'club_id': CLUB_IDENTIFIER, 'club_name': CLUB_NAME,
            'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                             'buildNumber': 1, 'engineType': 'react_native'},
        },
        'game_config': {'currency': 'coin', 'small_blind': 1, 'big_blind': 2,
                        'ante': 0, 'minimum_buy_in': 100, 'seat_quantity': 9,
                        'variation': 'texas_holdem'},
    },
    {
        'room_id': 'visual-club-room-two', 'room_name': '周末牌局',
        'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-club-owner',
        'building_id': CLUB_IDENTIFIER, 'building_type': 'club', 'game_type': 'texas_holdem',
        'room_status': 'opening', 'timer_status': 'wait_for_timing',
        'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 4,
        'options': {
            'club_id': CLUB_IDENTIFIER, 'club_name': CLUB_NAME,
            'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                             'buildNumber': 1, 'engineType': 'react_native'},
        },
        'game_config': {'currency': 'coin', 'small_blind': 2, 'big_blind': 4,
                        'ante': 0, 'minimum_buy_in': 200, 'seat_quantity': 9,
                        'variation': 'texas_holdem'},
    },
]


def respond(flow, result):
    """将固定结果按应用接口格式返回，并维持浏览器需要的跨域响应头。"""
    flow.response = http.Response.make(200, json.dumps(result).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


class ClubRoomVisualProxy:
    """只在专用场景中匹配指定俱乐部及其房间，其他请求保持原路径。"""

    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.network = VisualNetwork()
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.club_room_requests = {}

    def status(self):
        """提供代理启动探测及业务响应计数，供截图断言确认流量来源。"""
        return {
            'scenario': self.scenario,
            'interceptedRequests': sum(self.club_room_requests.values()),
            'proxiedRequests': self.proxied_requests,
            'stabilizedRequests': self.stabilized_requests,
            'clubRoomRequests': self.club_room_requests,
        }

    def control(self, flow):
        """只接受带本轮随机令牌的场景控制与状态查询。"""
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            flow.response = http.Response.make(403, b'{}')
            return
        path = urlsplit(flow.request.path).path
        if flow.request.method == 'POST' and path == '/scenario':
            try:
                scenario = json.loads(flow.request.content)['scenario']
            except (ValueError, KeyError, TypeError):
                scenario = False
            if scenario not in (None, 'visual-stable'):
                flow.response = http.Response.make(400, b'{}')
                return
            self.scenario = scenario
            self.club_room_requests = {}
        elif flow.request.method != 'GET' or path != '/status':
            flow.response = http.Response.make(400, b'{}')
            return
        respond(flow, self.status())

    def response(self, flow):
        """只在固定场景下整理真实代理选址响应。"""
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.stabilized_requests += self.network.response(flow)

    def fixture(self, flow):
        """校验请求方法、目标俱乐部及请求正文后，返回固定业务结果。"""
        url = urlsplit(flow.request.path)
        path = url.path
        method = flow.request.method
        if path == '/v10/club' and method == 'GET' and parse_qs(url.query).get('user_id'):
            return {'clubs': [{'id': CLUB_IDENTIFIER}]}
        if method != 'PUT':
            return None
        try:
            body = json.loads(flow.request.content)
        except (ValueError, TypeError):
            return None
        if path == '/v10/clubs' and body.get('club_ids') == [CLUB_IDENTIFIER]:
            return [{
                'id': CLUB_IDENTIFIER, 'club_id': CLUB_IDENTIFIER, 'club_no': 151,
                'name': CLUB_NAME, 'owner': {'id': 'visual-club-owner', 'role': 'owner'},
                'owner_id': 'visual-club-owner', 'admin_ids': [],
                'create_room_role': ['owner'], 'room_amount': 2,
            }]
        if path == '/v2/building/rooms' and body.get('building_ids') == [CLUB_IDENTIFIER]:
            return CLUB_ROOMS
        return None

    def request(self, flow):
        """控制请求单独处理；业务请求必须经过场景和 staging 地址核对。"""
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        if self.network.request(flow):
            self.stabilized_requests += 1
            return
        result = self.fixture(flow)
        if result is None:
            return
        path = urlsplit(flow.request.path).path
        self.club_room_requests[path] = self.club_room_requests.get(path, 0) + 1
        respond(flow, {'ok': True, 'result': result})


addons = [ClubRoomVisualProxy()]
