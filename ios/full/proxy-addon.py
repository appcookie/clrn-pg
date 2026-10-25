"""只在专用模拟器的代理边界复用 Web 响应，不改变模拟器应用包 或绕过应用初始化。"""

import asyncio
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit
from mitmproxy import ctx, http
from presentation import AccountPresentation
from game_session import GameSession
from launch_network import LaunchNetwork
from network_observer import NetworkObserver
from transport_diagnostics import TransportDiagnostics
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'e2e/mitmproxy'))
from network_faults import NetworkFaults
from response_overrides import is_staging


class IosVisualProxy:
    def __init__(self):
        self.launch = LaunchNetwork()
        self.observer = NetworkObserver()
        self.transport = TransportDiagnostics()
        self.functional = os.environ.get('IOS_FUNCTIONAL') == 'true'
        self.faults = NetworkFaults()
        self.presentation = AccountPresentation()
        self.records = None
        self.game = None
        self.game_session = None
        self.matching = os.environ.get('IOS_MATCHING') == 'true'
        self.matching_paths = {'/v1/hall_matching/join', '/v1/hall_matching/quit',
                               '/v1/hall_matching/keep_waiting'}
        self.slot = os.environ.get('IOS_SLOT') == 'true'
        self.slot_currency = 'coin'
        self.slot_no_energy = False
        self.slot_spins = 0
        self.skeleton = os.environ.get('IOS_SKELETON') == 'true'
        self.skeleton_hold = False
        self.skeleton_release = asyncio.Event()
        self.skeleton_loaded = 0
        self.skeleton_clubs = [{'id': f'00000000-0000-4000-8000-00000000010{index}',
                                'club_no': 100 + index, 'name': f'TestClub{index}',
                                'owner_id': 'visual-owner', 'member_count': 5,
                                'created_at': '2026-01-01T00:00:00Z', 'admin_ids': [],
                                'game_type': 'texas_holdem'} for index in (1, 2)]
        self.invitable = os.environ.get('IOS_INVITABLE') == 'true'
        directory = Path(__file__).resolve().parents[2] / 'visual/cases/club/mitmproxy'
        spec = importlib.util.spec_from_file_location('native_club_room_addon', directory / 'addon.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.club_rooms = module.ClubRoomVisualProxy()
        self.club_rooms_active = False
        self.auto_rebuy_hold = False
        self.auto_rebuy_requested = False
        self.auto_rebuy_release = asyncio.Event()
        self.auto_rebuy_release.set()
        game_type = os.environ.get('IOS_GAME')
        if game_type in ('texas-holdem', 'zhajinhua'):
            directory = Path(__file__).resolve().parents[2] / 'visual/cases' / game_type / 'mitmproxy'
            sys.path.insert(0, str(directory))
            spec = importlib.util.spec_from_file_location('native_game_addon', directory / 'addon.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.game = module.TexasVisualProxy() if game_type == 'texas-holdem' else module.ZhajinhuaVisualProxy()
            self.game.scenario = 'visual-stable'
            self.game_session = GameSession('texas_holdem' if game_type == 'texas-holdem' else 'zhajinhua')
        if os.environ.get('IOS_RECORDS') == 'true':
            sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'visual/cases/game-record/mitmproxy'))
            from addon import GameRecordProxy
            self.records = GameRecordProxy()
            self.records.scenario = 'visual-stable'

    def response(self, flow):
        self.transport.response(flow)
        self.observer.response(flow)
        if self.functional:
            return
        if (not flow.response or flow.response.status_code != 200
                or (flow.request.host != 'api.shafayouxi.org'
                    and not flow.request.host.endswith('.api.staging.laiwan.shafayouxi.com'))):
            return
        if self.game:
            previous_statistics_owner = self.game_session.statistics_owner
            self.game_session.response(flow)
            if (self.game_session.game_type == 'texas_holdem'
                    and self.game_session.statistics_owner
                    and self.game_session.statistics_owner != previous_statistics_owner):
                self.game.texas.arm_statistics(*self.game_session.statistics_owner)
            self.game.response(flow)
        try:
            body = flow.response.json()
        except ValueError:
            return
        path = urlsplit(flow.request.path).path
        normalized = self.presentation.normalize(path, flow.request.method, body)
        if self.game_session:
            normalized = self.game_session.normalize_room(path, flow.request.method, body) or normalized
        if normalized:
            flow.response.content = json.dumps(body).encode()
            for header in ('ETag', 'Content-MD5', 'Digest'):
                flow.response.headers.pop(header, None)
        if self.records:
            if self.presentation.user_id:
                self.records.user_id = self.presentation.user_id
            self.records.response(flow)

    def websocket_start(self, flow):
        self.transport.websocket_start(flow)

    def websocket_message(self, flow):
        self.transport.websocket_message(flow)
        if self.slot and flow.websocket:
            message = flow.websocket.messages[-1]
            if message.from_client and message.is_text and not message.injected:
                try:
                    frames = [json.loads(line) for line in message.text.splitlines() if line]
                except (ValueError, TypeError):
                    frames = []
                blocked = [frame for frame in frames if isinstance(frame, dict)
                           and frame.get('method') == 9 and isinstance(frame.get('params'), dict)
                           and isinstance(frame['params'].get('data'), dict)
                           and re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)',
                                            str(frame['params']['data'].get('path'))) is not None]
                if blocked:
                    kept = [frame for frame in frames if frame not in blocked]
                    if kept:
                        message.content = '\n'.join(json.dumps(frame) for frame in kept).encode()
                    else:
                        message.drop()
                    replies = []
                    for frame in blocked:
                        path = frame['params']['data']['path']
                        user_id = path.split('/')[4]
                        valid_user = self.presentation.user_id and user_id == self.presentation.user_id
                        data = self.slot_result(path.endswith('/spin')) if valid_user else {
                            'ok': False, 'error': 'unknown_user'}
                        if isinstance(frame.get('id'), int):
                            replies.append({'id': frame['id'], 'result': {'data': data}})
                    if replies:
                        ctx.master.commands.call('inject.websocket', flow, True,
                                                 '\n'.join(json.dumps(reply) for reply in replies).encode(), True)
        if self.matching and flow.websocket:
            message = flow.websocket.messages[-1]
            if message.from_client and message.is_text and not message.injected:
                try:
                    frames = [json.loads(line) for line in message.text.splitlines() if line]
                except (ValueError, TypeError):
                    frames = []
                blocked = [frame for frame in frames if isinstance(frame, dict)
                           and frame.get('method') == 9 and isinstance(frame.get('params'), dict)
                           and isinstance(frame['params'].get('data'), dict)
                           and frame['params']['data'].get('path') in self.matching_paths]
                if blocked:
                    kept = [frame for frame in frames if frame not in blocked]
                    if kept:
                        message.content = '\n'.join(json.dumps(frame) for frame in kept).encode()
                    else:
                        message.drop()
                    replies = [{'id': frame['id'], 'result': {'data': {'ok': True, 'result': {}}}}
                               for frame in blocked if isinstance(frame.get('id'), int)]
                    if replies:
                        ctx.master.commands.call('inject.websocket', flow, True,
                                                 '\n'.join(json.dumps(reply) for reply in replies).encode(), True)
        if self.game:
            self.game.websocket_message(flow)

    def websocket_end(self, flow):
        self.transport.websocket_end(flow)
        if self.game:
            self.game.websocket_end(flow)

    def tls_failed_client(self, data):
        self.transport.tls_failure('client', data)

    def tls_failed_server(self, data):
        self.transport.tls_failure('server', data)

    def error(self, flow):
        self.transport.response(flow)
        self.observer.response(flow)

    def done(self):
        self.observer.done()

    async def request(self, flow):
        if flow.request.host == 'test-mitmproxy.invalid' and urlsplit(flow.request.path).path == '/native/transport':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, json.dumps(self.transport.snapshot()).encode(),
                    {'Content-Type': 'application/json'})
            return
        self.transport.request(flow)
        if self.observer.control(flow):
            return
        if is_staging(flow.request.host):
            self.observer.request(flow)
        try:
            if is_staging(flow.request.host) and self.observer.override(flow):
                return
            if self.functional:
                path = urlsplit(flow.request.path).path
                if is_staging(flow.request.host) and path.startswith('/public/v11/user/register/'):
                    flow.response = http.Response.make(403, b'{"ok":false,"error":"native_test_registration_blocked"}',
                        {'Content-Type': 'application/json'})
                    return
                await self.faults.request(flow)
                return
            await self.route_request(flow)
        finally:
            if flow.response or flow.error:
                flow.metadata['ios_mocked'] = True

    async def route_request(self, flow):
        if await self.launch.request(flow):
            return
        path = urlsplit(flow.request.path).path
        if flow.request.host == 'test-mitmproxy.invalid' and path == '/native/club-rooms':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
                return
            if flow.request.method == 'POST':
                try:
                    active = json.loads(flow.request.content).get('active')
                except (ValueError, TypeError, AttributeError):
                    active = None
                if not isinstance(active, bool):
                    flow.response = http.Response.make(400, b'Invalid club room state')
                    return
                self.club_rooms_active = active
                self.club_rooms.club_room_requests = {}
            flow.response = http.Response.make(200, json.dumps({
                'active': self.club_rooms_active,
                'requests': self.club_rooms.club_room_requests,
            }).encode(), {'Content-Type': 'application/json'})
            return
        if self.club_rooms_active and is_staging(flow.request.host):
            result = self.club_rooms.fixture(flow)
            if result is not None:
                self.club_rooms.club_room_requests[path] = self.club_rooms.club_room_requests.get(path, 0) + 1
                flow.response = http.Response.make(200, json.dumps({'ok': True, 'result': result}).encode(),
                    {'Content-Type': 'application/json'})
                return
        if self.game and flow.request.host == 'test-mitmproxy.invalid' \
                and path == '/android/auto-rebuy-hold':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
                return
            if flow.request.method == 'POST':
                settings = json.loads(flow.request.content)
                self.auto_rebuy_hold = settings.get('hold') is True
                if self.auto_rebuy_hold:
                    self.auto_rebuy_requested = False
                    self.auto_rebuy_release.clear()
                else:
                    self.auto_rebuy_release.set()
            flow.response = http.Response.make(200, json.dumps({'hold': self.auto_rebuy_hold,
                'requested': self.auto_rebuy_requested}).encode(), {'Content-Type': 'application/json'})
            return
        if self.game and self.auto_rebuy_hold and flow.request.method == 'PUT' \
                and re.fullmatch(r'/v10/texas_holdem/room/[^/]+/user_settings/enable_auto_rebuy', path):
            self.auto_rebuy_requested = True
            try:
                await asyncio.wait_for(self.auto_rebuy_release.wait(), timeout=45)
            except asyncio.TimeoutError:
                flow.response = http.Response.make(504, b'Visual auto-rebuy hold expired')
                return
            # 释放后回放成功响应；隔离房间的真实后端可能拒绝修改设置。
            flow.response = http.Response.make(200, b'{"ok":true,"result":{"auto_rebuy":true}}',
                                               {'Content-Type': 'application/json'})
            return
        if self.invitable and path == '/v2/building/rooms' and flow.request.method == 'PUT':
            room = {'room_id': '00000000-0000-4000-8000-000000000099', 'room_name': 'TestRoom',
                    'created_at': '2026-01-01T00:00:00Z', 'creator_id': 'visual-user-id',
                    'building_id': 'visual-house-id', 'building_type': 'house', 'game_type': 'texas_holdem',
                    'room_status': 'opening', 'timer_status': 'wait_for_timing',
                    'remaining_seconds': 3600, 'booking_seconds': 3600, 'seat_occupied': 0,
                    'options': {'game_version': {'type': 'texas_holdem', 'variant': 'normal',
                                                 'buildNumber': 1, 'engineType': 'react_native'}},
                    'game_config': {'currency': 'coin', 'small_blind': 1, 'big_blind': 2, 'ante': 0,
                                    'minimum_buy_in': 100, 'seat_quantity': 9,
                                    'variation': 'texas_holdem'}}
            flow.response = http.Response.make(200, json.dumps({'ok': True, 'result': [room]}).encode(),
                                               {'Content-Type': 'application/json'})
            return
        if self.skeleton and flow.request.host == 'test-mitmproxy.invalid' and path == '/android/skeleton':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
                return
            if flow.request.method == 'POST':
                settings = json.loads(flow.request.content)
                self.skeleton_hold = settings.get('hold') is True
                if not self.skeleton_hold:
                    self.skeleton_release.set()
                else:
                    self.skeleton_release.clear()
            flow.response = http.Response.make(200, json.dumps({'loaded': self.skeleton_loaded,
                'holding': self.skeleton_hold}).encode(), {'Content-Type': 'application/json'})
            return
        if self.skeleton and path == '/v10/club' and flow.request.method == 'GET' \
                and 'user_id' in urlsplit(flow.request.path).query:
            body = {'ok': True, 'result': {'clubs': [{'id': club['id']} for club in self.skeleton_clubs]}}
            flow.response = http.Response.make(200, json.dumps(body).encode(), {'Content-Type': 'application/json'})
            return
        if self.skeleton and path == '/v10/clubs' and flow.request.method == 'PUT':
            if self.skeleton_hold:
                await self.skeleton_release.wait()
            self.skeleton_loaded += 1
            flow.response = http.Response.make(200, json.dumps({'ok': True, 'result': self.skeleton_clubs}).encode(),
                                               {'Content-Type': 'application/json'})
            return
        if self.slot and flow.request.host == 'test-mitmproxy.invalid' and urlsplit(flow.request.path).path == '/android/slot':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
                return
            if flow.request.method == 'POST':
                try:
                    settings = json.loads(flow.request.content)
                except (ValueError, TypeError):
                    settings = {}
                if settings.get('currency') not in ('coin', 'currency_diamond', 'energy'):
                    flow.response = http.Response.make(400, b'Invalid slot currency')
                    return
                self.slot_currency = settings['currency']
                self.slot_no_energy = settings.get('noEnergy') is True
            flow.response = http.Response.make(200, json.dumps({'spins': self.slot_spins,
                'currency': self.slot_currency, 'noEnergy': self.slot_no_energy}).encode(),
                {'Content-Type': 'application/json'})
            return
        if self.slot and re.fullmatch(r'/v10/wallet/[^/]+', urlsplit(flow.request.path).path) \
                and flow.request.method == 'PUT':
            requested_user = urlsplit(flow.request.path).path.split('/')[3]
            if not self.presentation.user_id or requested_user != self.presentation.user_id:
                flow.response = http.Response.make(403, b'Unknown slot account')
                return
            wallet = {'ok': True, 'result': {'currencies': [
                {'code': 'coin', 'name': '金币', 'balance': '10000'},
                {'code': 'diamond', 'name': '钻石', 'balance': '60'}]}}
            flow.response = http.Response.make(200, json.dumps(wallet).encode(),
                {'Content-Type': 'application/json'})
            return
        if self.slot and re.fullmatch(r'/v2/slot_machine/user/[^/]+/(energy|spin)',
                                      urlsplit(flow.request.path).path):
            path = urlsplit(flow.request.path).path
            valid_user = self.presentation.user_id and path.split('/')[4] == self.presentation.user_id
            data = self.slot_result(path.endswith('/spin')) if valid_user else {'ok': False, 'error': 'unknown_user'}
            flow.response = http.Response.make(200, json.dumps(data).encode(), {'Content-Type': 'application/json'})
            return
        if self.matching and urlsplit(flow.request.path).path in self.matching_paths:
            flow.response = http.Response.make(200, b'{"ok":true,"result":{}}',
                                               {'Content-Type': 'application/json'})
            return
        if self.game and flow.request.host == 'test-mitmproxy.invalid' and urlsplit(flow.request.path).path == '/android/session':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, json.dumps({
                    'account': self.game_session.account, 'room': self.game_session.room}).encode(),
                    {'Content-Type': 'application/json'})
            return
        if self.game:
            self.game.request(flow)
            if flow.response:
                return
        if self.records:
            await self.records.request(flow)
            if flow.response:
                return
        if flow.request.host == 'test-mitmproxy.invalid':
            if flow.request.headers.get('X-E2E-Control-Token') != os.environ['MITMPROXY_CONTROL_TOKEN']:
                flow.response = http.Response.make(403, b'Forbidden')
            else:
                flow.response = http.Response.make(200, b'{"scenario":"visual-stable"}')
            return
        if flow.request.method == 'CONNECT':
            return
        # 39580516924 的真实重连在 Node 夹具查询中等待约10秒后触发应用超时。
        # 这些端点没有 Web 夹具，直接透传；上面的启动暂缓、节点排除和故障
        # 注入仍先执行。录像像素分析不能阻塞健康检查或 WebSocket 握手。
        if is_staging(flow.request.host) and path in {
                '/node/v1/status', '/public/v12/metadata/servers',
                '/public/v13/metadata/servers', '/v2/centrifugo/connection/websocket'}:
            return
        payload = json.dumps({'url': flow.request.pretty_url}).encode()
        request = urllib.request.Request(os.environ['IOS_FIXTURE_URL'], data=payload,
            headers={'Content-Type': 'application/json',
                     'Authorization': os.environ['IOS_FIXTURE_TOKEN']})
        self.transport.fixture_started(flow)
        try:
            result = await asyncio.to_thread(self.fixture_response, request)
        finally:
            self.transport.fixture_finished(flow)
        if result is None:
            return
        if result.get('aborted'):
            flow.kill()
            return
        flow.response = http.Response.make(result.get('status', 200),
            result.get('body', '').encode(),
            {'Content-Type': result.get('contentType', 'application/json')})

    @staticmethod
    def fixture_response(request):
        # 不读取 macOS 系统代理，避免夹具回调再次进入当前代理。
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        if urlsplit(request.full_url).hostname != '127.0.0.1':
            raise ValueError('Fixture server must use loopback')
        with opener.open(request, timeout=10) as response:
            return json.load(response)

    def slot_result(self, spin):
        energy = {'user_energy': {'total_energy': 0}, 'energy_factory': {
            'capacity': 50, 'quantity': 50, 'remaining_production_time': '00:00:00'}}
        if not spin:
            return {'ok': True, 'result': energy}
        self.slot_spins += 1
        if self.slot_no_energy:
            return {'ok': False, 'error': 'energy_not_enough', 'error_description': 'No energy'}
        currency = self.slot_currency
        return {'ok': True, 'result': {**energy, 'outcome': [currency, currency, currency],
            'reward': {'outcome_pattern': 'three', 'prize': {
                'coin': 100 if currency == 'coin' else 0,
                'diamond': 5 if currency == 'currency_diamond' else 0,
                'energy': 10 if currency == 'energy' else 0}}}}


addons = [IosVisualProxy()]
