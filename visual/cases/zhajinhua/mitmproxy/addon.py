"""拼三张独立代理：真实动态选线，只回放本例真实创建的私人房。"""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from mitmproxy import http
from zhajinhua_replay import UUID, PLAYER_IDS, ZhajinhuaReplay

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles  # noqa: E402

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


class ZhajinhuaVisualProxy:
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.proxied_requests = 0
        self.stabilized_requests = 0
        self.created_room_id = None
        self.replay = ZhajinhuaReplay()

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
                    self.replay.release()
                    self.created_room_id = None
                elif self.scenario == 'visual-stable' and path == '/zhajinhua/replay-ready':
                    if not self.created_room_id or body.get('roomId') != self.created_room_id:
                        raise ValueError('Replay requires this test room')
                    respond(flow, replay_readiness(self.replay, 'zhajinhua', body.get('roomId')))
                    return
                elif self.scenario == 'visual-stable' and path == '/zhajinhua/replay':
                    if not self.created_room_id or body.get('roomId') != self.created_room_id:
                        raise ValueError('Replay requires this test room')
                    self.replay.publish(body['roomId'], body.get('data'))
                elif self.scenario == 'visual-stable' and path == '/zhajinhua/operation-reward':
                    self.replay.set_operation_reward(body.get('roomId'), body.get('enabled'))
                elif path == '/zhajinhua/release':
                    self.replay.release()
                    self.created_room_id = None
                else:
                    raise ValueError('Unknown command')
            elif flow.request.method != 'GET' or path != '/status':
                raise ValueError('Unknown command')
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            respond(flow, replay_error(error, self.replay, 'zhajinhua', body), 400)
            return
        respond(flow, {
            'scenario': self.scenario, 'interceptedRequests': 0,
            'proxiedRequests': self.proxied_requests, 'stabilizedRequests': self.stabilized_requests,
            'replayedMessages': self.replay.replayed_messages, 'blockedRpcs': self.replay.blocked_rpcs,
        })

    def response(self, flow):
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        path = urlsplit(flow.request.path).path
        if self.replay.room_id and path == '/v10/profile/users':
            self.stabilized_requests += patch_profiles(flow, self.replay.self_id,
                {player: self.replay.profile(player) for player in PLAYER_IDS})
        if (flow.request.method != 'POST' or path != '/v3/pay_action/do'
                or not flow.response or flow.response.status_code != 200 or self.created_room_id):
            return
        try:
            request = json.loads(flow.request.content)
            action = request.get('action_url')
            config = request.get('action_json')
            body = json.loads(flow.response.content)
            room_id = body.get('result', {}).get('room_id')
            if (isinstance(action, dict) and isinstance(config, dict)
                    and action.get('method') == 'POST'
                    and action.get('path') in ('/v2/building/$building_id$/room', '/v2/building/<building_id>/room')
                    and config.get('game_type') == 'zhajinhua' and body.get('ok') is True
                    and isinstance(room_id, str) and re.fullmatch(UUID, room_id, re.I)):
                self.created_room_id = room_id
        except (ValueError, TypeError, AttributeError):
            return

    def websocket_message(self, flow):
        if self.scenario == 'visual-stable' and is_staging(flow.request.host):
            self.replay.websocket_message(flow)

    def websocket_end(self, flow):
        self.replay.websocket_end(flow)

    def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied_requests += 1
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        if self.replay.room_id and prepare_profiles(flow, self.replay.self_id, PLAYER_IDS):
            return
        path = urlsplit(flow.request.path).path
        if flow.request.method == 'GET' or (flow.request.method == 'PUT' and path == '/v10/profile/users'):
            try:
                fixture = self.replay.http_fixture(path, flow.request.content)
            except (ValueError, TypeError, AttributeError):
                return
            if fixture is None:
                return
            data, status = {'ok': True, 'result': fixture}, 200
        else:
            return
        respond(flow, data, status)
        self.stabilized_requests += 1


addons = [ZhajinhuaVisualProxy()]
