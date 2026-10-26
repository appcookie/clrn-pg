"""用真实 HTTPFlow 核对俱乐部房间代理的业务响应、范围和访问限制。"""

import json
import unittest
from unittest.mock import patch

from mitmproxy import connection, http

with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
    from addon import CLUB_IDENTIFIER, ClubRoomVisualProxy


def make_flow(path, method='GET', body=None, host='api.shafayouxi.org', token=None):
    """建立仅供代理单元测试使用的请求，不访问真实后端。"""
    flow = http.HTTPFlow(
        connection.Client(peername=('127.0.0.1', 12345), sockname=('127.0.0.1', 8080)),
        connection.Server(address=(host, 443)), live=True)
    flow.request = http.Request.make(method, f'https://{host}{path}',
                                     b'' if body is None else json.dumps(body).encode())
    if token:
        flow.request.headers['X-E2E-Control-Token'] = token
    return flow


class ClubRoomVisualProxyTests(unittest.TestCase):
    """逐个验证截图场景必需的三个接口和隔离条件。"""

    def setUp(self):
        """每个用例使用独立代理状态。"""
        with patch.dict('os.environ', {'MITMPROXY_CONTROL_TOKEN': 'test-token'}):
            self.proxy = ClubRoomVisualProxy()

    def test_populated_room_responses(self):
        """启用固定场景后，俱乐部资料和两条房间使用一致的标识。"""
        control = make_flow('/scenario', 'POST', {'scenario': 'visual-stable'},
                            'test-mitmproxy.invalid', 'test-token')
        self.proxy.request(control)
        self.assertEqual(control.response.status_code, 200, '代理场景应成功启用')

        joined = make_flow('/v10/club?user_id=visual-user')
        self.proxy.request(joined)
        joined_result = json.loads(joined.response.content)['result']
        self.assertEqual(joined_result['clubs'], [{'id': CLUB_IDENTIFIER}], '加入的俱乐部标识应固定')

        club = make_flow('/v10/clubs', 'PUT', {'club_ids': [CLUB_IDENTIFIER]})
        self.proxy.request(club)
        club_result = json.loads(club.response.content)['result']
        self.assertEqual(club_result[0]['name'], '演示俱乐部', '俱乐部名称应在卡片中可读')

        rooms = make_flow('/v2/building/rooms', 'PUT', {'building_ids': [CLUB_IDENTIFIER]})
        self.proxy.request(rooms)
        room_result = json.loads(rooms.response.content)['result']
        self.assertEqual(len(room_result), 2, '列表应包含两条固定牌局')
        self.assertEqual([room['seat_occupied'] for room in room_result], [2, 4],
                         '两条牌局应展示不同人数')
        self.assertTrue(all(room['building_id'] == CLUB_IDENTIFIER for room in room_result),
                        '牌局必须属于目标俱乐部')
        self.assertEqual(self.proxy.status()['interceptedRequests'], 3,
                         '三种业务接口都必须由代理提供响应')

    def test_unrelated_requests_pass_through(self):
        """未启用场景、其他俱乐部和非 staging 地址不接受固定数据。"""
        before = make_flow('/v10/club?user_id=visual-user')
        self.proxy.request(before)
        self.assertIsNone(before.response, '未启用场景时不得替换业务响应')
        self.proxy.scenario = 'visual-stable'

        other_club = make_flow('/v2/building/rooms', 'PUT', {'building_ids': ['other-club']})
        self.proxy.request(other_club)
        self.assertIsNone(other_club.response, '其他俱乐部房间应继续访问真实接口')

        other_host = make_flow('/v10/club?user_id=visual-user', host='example.com')
        self.proxy.request(other_host)
        self.assertIsNone(other_host.response, '非 staging 地址不得收到固定俱乐部')

    def test_control_requires_token(self):
        """没有本轮令牌的控制请求不能启用固定场景。"""
        request = make_flow('/scenario', 'POST', {'scenario': 'visual-stable'},
                            'test-mitmproxy.invalid')
        self.proxy.request(request)
        self.assertEqual(request.response.status_code, 403, '无令牌的控制请求必须拒绝')
        self.assertIsNone(self.proxy.scenario, '拒绝后代理仍应保持默认转发状态')
