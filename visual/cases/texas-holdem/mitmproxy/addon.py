"""德州视觉测试专用代理；App 和其他玩法不会加载此脚本。"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http
from texas_replay import PLAYER_IDS, TABLE_PLAYER_IDS, TexasReplay
from room_view import RoomView
from game_log import fixture as log_fixture
from records_v2 import RecordsV2
from ui_states import UIStates

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402

from replay_control import replay_readiness, replay_error  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'


def respond(flow, data, status=200):
    flow.response = http.Response.make(status, json.dumps(data).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


class TexasVisualProxy:
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.texas = TexasReplay()
        self.view = RoomView()
        self.records = RecordsV2()
        self.ui = UIStates()

    def control(self, flow):
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            respond(flow, {'error': 'Forbidden'}, 403)
            return
        path = urlsplit(flow.request.path).path
        body = None
        try:
            if flow.request.method == 'POST':
                body = json.loads(flow.request.content)
                if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
                    self.scenario = body['scenario']
                    self.texas.release()
                    self.view.configure(None)
                    self.records.release()
                    self.ui.release()
                elif self.scenario == 'visual-stable' and path == '/texas/view':
                    self.view.configure(body.get('mode'))
                elif self.scenario == 'visual-stable' and path == '/texas/replay-ready':
                    respond(flow, replay_readiness(self.texas, 'texas_holdem', body.get('roomId')))
                    return
                elif self.scenario == 'visual-stable' and path == '/texas/replay':
                    self.texas.publish(body.get('roomId'), body.get('data'))
                elif self.scenario == 'visual-stable' and path == '/texas/records':
                    self.records.configure(body.get('empty'))
                    if self.view.mode != 'record-v2':
                        self.view.configure('record-v2')
                elif self.scenario == 'visual-stable' and path == '/texas/ui' and self.texas.room_id:
                    self.ui.configure(body)
                    self.texas.ui_states = self.ui
                elif path == '/texas/release':
                    self.texas.release()
                    self.view.configure(None)
                    self.records.release()
                    self.ui.release()
                else:
                    raise ValueError('Unknown command')
            elif flow.request.method != 'GET' or path != '/status':
                raise ValueError('Unknown command')
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            respond(flow, replay_error(error, self.texas, 'texas_holdem', body), 400)
            return
        respond(flow, {
            'scenario': self.scenario, 'interceptedRequests': 0,
            'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests,
            'replayedMessages': self.texas.replayed_messages,
            'selfStatistics': {'authorized': self.texas.self_statistics_authorized(),
                               'responses': self.texas.self_statistics_responses},
        })

    def websocket_message(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.texas.websocket_message(flow)

    def websocket_end(self, flow):
        self.texas.websocket_end(flow)

    def response(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            path = urlsplit(flow.request.path).path
            if self.texas.room_id and path == '/v10/profile/users':
                self.stabilized_requests += patch_profiles(flow, self.texas.self_id,
                    {player: self.texas.profile(player) for player in TABLE_PLAYER_IDS})
            if self.records.enabled and flow.request.method == 'GET' and path == '/public/v11/game_log/available.json':
                self.stabilized_requests += patch_version(flow, 'v11')
            self.view.response(flow, path)
            try:
                self.records.response(flow, path, self.view.room_id)
            except (ValueError, TypeError, AttributeError):
                pass
            if self.view.room_id and not self.texas.room_id:
                # 大厅入口会自动请求入座；从房间创建响应开始隔离其 RPC，避免真实带入。
                self.texas.arm_created_room(self.view.room_id, self.view.self_id)
            if self.view.self_id and not self.texas.self_id:
                self.texas.self_id = self.view.self_id

    def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        if self.texas.room_id and prepare_profiles(flow, self.texas.self_id, TABLE_PLAYER_IDS):
            return
        path = urlsplit(flow.request.path).path
        try:
            fixture = self.ui.fixture(flow.request.path, flow.request.method, flow.request.content, self.texas.room_id)
        except (ValueError, TypeError, AttributeError):
            return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        fixture = self.records.fixture(path, flow.request.method, self.texas.self_id)
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        try:
            fixture = self.view.fixture(path, flow.request.method, self.texas.self_id, flow.request.content)
        except (ValueError, TypeError, AttributeError):
            return
        if fixture is None:
            try:
                fixture = log_fixture(path, flow.request.method, flow.request.content,
                                      self.texas.room_id, self.texas.self_id)
            except (ValueError, TypeError, AttributeError):
                return
        if fixture is not None:
            respond(flow, {'ok': True, 'result': fixture})
            self.stabilized_requests += 1
            return
        if self.texas.room_id and path == '/v1/hall_matching/blacklist' and flow.request.method in ('POST', 'DELETE'):
            try:
                player_id = json.loads(flow.request.content).get('black_user_id')
            except (ValueError, TypeError, AttributeError):
                return
            if player_id not in PLAYER_IDS:
                return
            data, status = {'ok': True, 'result': {}}, 200
        elif flow.request.method == 'GET' or (flow.request.method == 'PUT' and path == '/v10/profile/users'):
            try:
                fixture = self.texas.http_fixture(path, flow.request.content)
            except (ValueError, TypeError, AttributeError):
                return
            if fixture is None:
                return
            data, status = {'ok': True, 'result': fixture}, 200
        else:
            return
        respond(flow, data, status)
        self.stabilized_requests += 1


addons = [TexasVisualProxy()]
