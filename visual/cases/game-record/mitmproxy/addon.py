"""我的战绩独立代理；数据仅匹配控制端指定的账号和固定记录。"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from mitmproxy import http
from data import CLUB, HOUSE, PLAYER, all_records, detail, records, replay, rooms, round_data, settlements

# mitmdump 将 addon 目录加入 sys.path；三个独立代理共用字段覆盖工具。
sys.path.insert(0, str(Path(__file__).resolve().parents[4] / 'e2e' / 'mitmproxy'))
from response_overrides import is_staging, prepare_profiles, patch_profiles, patch_version  # noqa: E402

CONTROL_HOST = 'test-mitmproxy.invalid'
MODES = ('empty', 'list', 'no-hands', 'paged', 'list-error', 'detail-error', 'delete-error')


def respond(flow, result, status=200, wrapped=True):
    data = {'ok': True, 'result': result} if wrapped else result
    flow.response = http.Response.make(status, json.dumps(data).encode(), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
        'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
    })


class GameRecordProxy:
    def __init__(self):
        self.token = os.environ['MITMPROXY_CONTROL_TOKEN']
        self.scenario = None
        self.user_id = None
        self.version = 'legacy'
        self.mode = 'empty'
        self.deleted = []
        self.hold = asyncio.Event()
        self.hold.set()
        self.counts = {}
        self.faults = {}
        self.proxied = 0
        self.stabilized = 0

    def status(self):
        return {'scenario': self.scenario, 'interceptedRequests': sum(self.counts.values()),
                'proxiedRequests': self.proxied, 'stabilizedRequests': self.stabilized,
                'recordRequests': self.counts, 'faultRequests': self.faults, 'deleted': self.deleted}

    def control(self, flow):
        if flow.request.headers.get('X-E2E-Control-Token') != self.token:
            respond(flow, {'error': 'Forbidden'}, 403, False)
            return
        path = urlsplit(flow.request.path).path
        try:
            if flow.request.method == 'POST':
                body = json.loads(flow.request.content)
                if path == '/scenario' and body.get('scenario') in (None, 'visual-stable'):
                    self.scenario = body['scenario']
                    self.user_id = None
                    self.deleted = []
                    self.hold.set()
                elif path == '/records/release':
                    self.hold.set()
                elif self.scenario == 'visual-stable' and path in ('/records/configure', '/records/mode'):
                    mode = body.get('mode')
                    hold = body.get('hold', False)
                    if mode not in MODES or not isinstance(hold, bool):
                        raise ValueError('Invalid mode')
                    if path == '/records/configure':
                        user_id, version = body.get('userId'), body.get('version')
                        if not isinstance(user_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', user_id):
                            raise ValueError('Invalid user')
                        if version not in ('legacy', 'v2'):
                            raise ValueError('Invalid version')
                        self.user_id, self.version = user_id, version
                        self.deleted, self.counts, self.faults = [], {}, {}
                    self.mode = mode
                    self.hold.clear() if hold else self.hold.set()
                else:
                    raise ValueError('Unknown command')
            elif flow.request.method != 'GET' or path != '/status':
                raise ValueError('Unknown command')
        except (ValueError, KeyError, TypeError, AttributeError):
            respond(flow, {'error': 'Invalid command'}, 400, False)
            return
        respond(flow, self.status(), wrapped=False)

    def fixture(self, path, method, body, query):
        user = self.user_id
        source = all_records() if self.mode == 'paged' else records()
        data = [record for record in source if record['play_session_id'] not in self.deleted
                and (self.mode != 'no-hands' or record['all_round_count'] == 0)]
        ids = {record['play_session_id'] for record in all_records()}
        if not user:
            return None
        if path == f'/v10/texas_holdem/user/{user}/game_records' and method == 'GET':
            selected = [] if self.mode == 'empty' else data
            next_page = None
            if self.mode == 'paged':
                if query.get('next_page') == ['visual-page-2']:
                    selected = data[20:]
                else:
                    selected, next_page = data[:20], 'visual-page-2'
            return {'next_page': next_page, 'items': [
                {'room_id': item['play_session_id'], 'create_at': item['create_at']} for item in selected]}
        if path == f'/v11/game_log/{user}/play_session_record/recent' and method == 'PUT':
            if body.get('user_id') != user:
                return None
            return {'records': [] if self.mode == 'empty' else data}
        session_path = f'/v11/game_log/{user}/play_session_record/'
        if path.startswith(session_path) and method == 'GET' and path[len(session_path):] in ids:
            return detail(user, path[len(session_path):])
        round_path = f'/v11/game_log/{user}/round/'
        if path.startswith(round_path) and method == 'GET' and path[len(round_path):].removesuffix('-round') in ids:
            return round_data(user, path[len(round_path):].removesuffix('-round'))
        if path == '/v1/room' and method == 'PUT' and set(body.get('rooms', [])) <= ids:
            return {room_id: rooms()[room_id] for room_id in body['rooms']}
        if path.startswith('/v1/room/') and method == 'GET' and path[9:] in ids:
            room = rooms()[path[9:]]
            if path.endswith('private'):
                room['room_status'] = 'open'
                room['timer_status'] = 'timing'
                room['remaining_seconds'] = 3600
            return room
        if path in ('/v1/game_log/room/settlement', '/v11/game_log/room/settlement') and method == 'PUT':
            requested = body.get('room_ids', [])
            if not set(requested) <= ids:
                return None
            return {'rooms_settlements': {room_id: settlements(user, room_id) for room_id in requested}}
        if path == f'/v1/game_log/user/{user}/rooms/settlement' and method == 'PUT':
            requested = body.get('room_ids', [])
            if not set(requested) <= ids:
                return None
            return {'rooms_settlement': [dict(settlements(user, room_id)[0], room_id=room_id)
                                        for room_id in requested if settlements(user, room_id)]}
        if path == '/v10/club' and method == 'GET' and query.get('user_id') == [user]:
            return {'clubs': [{'id': CLUB, 'club_id': CLUB, 'name': 'Visual Club', 'room_amount': 0}]}
        if path == '/v10/clubs' and method == 'PUT' and body.get('club_ids') == [CLUB]:
            return [{'club_id': CLUB, 'name': 'Visual Club', 'avatar': '', 'room_amount': 0}]
        if path == '/v10/profile/users' and method == 'PUT' and set(body.get('users', [])) <= {PLAYER, HOUSE}:
            return {player: {'user_id': player, 'nickname': 'Opponent',
                             'avatarPath': ''} for player in body['users']}
        if path.startswith(f'/v1/game_log/user/{user}/room/') and method == 'DELETE':
            room_id = path.rsplit('/', 1)[-1]
            if room_id in ids:
                if self.mode != 'delete-error':
                    self.deleted.append(room_id)
                return {}
        for room_id in ids:
            if path == f'/v1/game_log/room/{room_id}/game_amount' and method == 'GET':
                return {'game_amount': 0 if room_id.endswith('empty') else 3}
            if path == f'/v1/game_log/room/{room_id}/game' and method == 'PUT':
                return {'results': [] if room_id.endswith('empty') else [
                    {'game_id': f'{room_id}-game-{i}', 'game_number': i} for i in body['game_numbers']]}
            if path == f'/v1/game_log/room/{room_id}/settlement' and method == 'GET':
                return {'settlements': settlements(user, room_id)}
        if path == '/v1/game_log/room/game_amount' and method == 'PUT' and set(body.get('room_ids', [])) <= ids:
            return {'results': [{'room_id': room_id, 'game_amount': 0 if room_id.endswith('empty') else 3}
                                for room_id in body['room_ids']]}
        if path == f'/v1/game_log/user/{user}/games' and method == 'PUT':
            game_ids = body.get('game_ids', [])
            if not set(game_ids) <= {f'{session}-game-{i}' for session in ids for i in range(1, 4)}:
                return None
            return {'results': [replay(user, int(game_id.rsplit('-', 1)[-1]), game_id.rsplit('-game-', 1)[0])
                                for game_id in game_ids]}
        return None

    def response(self, flow):
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        if not self.user_id:
            return
        path = urlsplit(flow.request.path).path
        if path == '/v10/profile/users':
            self.stabilized += patch_profiles(flow, self.user_id, {
                player: {'user_id': player, 'nickname': 'Opponent', 'avatarPath': ''}
                for player in (PLAYER, HOUSE)})
        if flow.request.method == 'GET' and path == '/public/v11/game_log/available.json':
            self.stabilized += patch_version(flow, 'v11' if self.version == 'v2' else 'v1')

    async def request(self, flow):
        if flow.request.host == CONTROL_HOST:
            self.control(flow)
            return
        self.proxied += 1
        if self.scenario != 'visual-stable' or not is_staging(flow.request.host):
            return
        url = urlsplit(flow.request.path)
        path, method = url.path, flow.request.method
        if self.user_id and prepare_profiles(flow, self.user_id, (PLAYER, HOUSE)):
            return
        try:
            body = json.loads(flow.request.content or b'{}')
            fixture = self.fixture(path, method, body, parse_qs(url.query))
        except (ValueError, TypeError, KeyError, AttributeError):
            return
        if fixture is None:
            return
        self.counts[path] = self.counts.get(path, 0) + 1
        is_list = path.endswith('/game_records') or path.endswith('/recent')
        if is_list and (self.mode != 'paged' or parse_qs(url.query).get('next_page')):
            await self.hold.wait()
        fail = ((self.mode == 'list-error' and is_list)
                or (self.mode == 'detail-error' and '/play_session_record/' in path and not is_list)
                or (self.mode == 'delete-error' and method == 'DELETE'))
        if fail:
            self.faults[path] = self.faults.get(path, 0) + 1
            # 旧版 HTTP 5xx 会触发节点切换；业务错误避免把节点状态失败冒充删除错误。
            status = 503 if self.mode == 'list-error' else 200
            respond(flow, {'ok': False, 'error_type': 'visual_record_unavailable',
                           'error_message': 'Visual record service unavailable',
                           'message': 'Visual record service unavailable'}, status, False)
        else:
            respond(flow, fixture)


addons = [GameRecordProxy()]
