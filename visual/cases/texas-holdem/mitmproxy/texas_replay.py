"""在真实房间连接上回放德州消息，禁止把夹具操作发送到游戏服务。"""

import json
import re
from mitmproxy import ctx

UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 5)]
TABLE_PLAYER_IDS = [f"00000000-0000-4000-8000-{index:012d}" for index in range(1, 9)]


class TexasReplay:
    def __init__(self):
        self.subscriptions = {}
        self.pending_subscriptions = {}
        self.room_id = None
        self.replayed_messages = 0
        self.self_id = None
        self.created_room_id = None
        self.statistics_owner = None
        self.self_statistics_responses = 0
        self.ui_states = None

    def arm_created_room(self, room_id, self_id):
        self.room_id = self.created_room_id = room_id
        self.self_id = self_id

    def arm_statistics(self, room_id, self_id):
        """Authorize only self's read-only statistics after verified creation.

        Private gameplay does not enable RoomView, so it never arms the broad
        created-room RPC guard. Keep that behavior independent of this fixture.
        """
        if not all(isinstance(value, str) and re.fullmatch(UUID, value, re.I)
                   for value in (room_id, self_id)):
            raise ValueError('Invalid statistics owner')
        if (self.room_id and self.room_id != room_id) or (self.self_id and self.self_id != self_id):
            raise ValueError('Statistics owner differs from active replay')
        self.statistics_owner = (room_id, self_id)

    def publish(self, room_id, data):
        if not isinstance(room_id, str) or not re.fullmatch(UUID, room_id, re.I) or not isinstance(data, dict):
            raise ValueError("Invalid replay")
        if self.room_id and room_id != self.room_id:
            raise ValueError('Another room already owns this replay')
        targets = [
            (flow, channel) for flow, channels in self.subscriptions.values()
            if flow.websocket.timestamp_end is None
            for channel in channels
            if re.fullmatch(rf"texas_holdem>{room_id}#{UUID}", channel, re.I)
        ]
        if not targets:
            raise ValueError("No subscribed Texas room")
        self.room_id = room_id
        self.self_id = targets[0][1].rsplit('#', 1)[-1]
        # Centrifuge v2 JSON 协议：无 id 的消息是服务端推送，type=0 表示 publication。
        for flow, channel in targets:
            payload = {"result": {"type": 0, "channel": channel, "data": {"data": data}}}
            ctx.master.commands.call("inject.websocket", flow, True, json.dumps(payload).encode(), True)
            self.replayed_messages += 1

    def release(self):
        self.room_id = None
        self.self_id = None
        self.created_room_id = None
        self.statistics_owner = None
        self.self_statistics_responses = 0
        self.ui_states = None

    def self_statistics_authorized(self):
        return bool(self.room_id and self.self_id
                    and (self.created_room_id == self.room_id
                         or self.statistics_owner == (self.room_id, self.self_id)))

    def is_replay_publication(self, frame):
        result = frame.get('result')
        if 'id' in frame or not isinstance(result, dict) or result.get('type', 0) != 0:
            return False
        channel = result.get('channel')
        return isinstance(channel, str) and re.fullmatch(
            rf'texas_holdem>{self.room_id}#{UUID}', channel, re.I) is not None

    def websocket_message(self, flow):
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected:
            return
        try:
            frames = [json.loads(line) for line in message.text.splitlines() if line]
        except (ValueError, TypeError):
            return
        if not all(isinstance(frame, dict) for frame in frames):
            return
        if message.from_client:
            channels = self.subscriptions.setdefault(flow.id, (flow, set()))[1]
            pending = self.pending_subscriptions.setdefault(flow.id, {})
            for frame in frames:
                params = frame.get("params") or {}
                if not isinstance(params, dict):
                    continue
                if (frame.get("method") == 1 and isinstance(frame.get('id'), int)
                        and frame['id'] > 0 and isinstance(params.get("channel"), str)):
                    pending[frame['id']] = params['channel']
                if frame.get("method") == 2 and isinstance(params.get('channel'), str):
                    channel = params.get('channel')
                    channels.discard(channel)
                    for command_id in [command_id for command_id, target in pending.items() if target == channel]:
                        pending.pop(command_id)
            # 本次新建的房间须在订阅前隔离自动入座；其他回放仍要求目标频道所在连接。
            target_flow = self.room_id and (self.created_room_id == self.room_id or any(
                channel.startswith(f"texas_holdem>{self.room_id}#") for channel in channels))
            blocked = [frame for frame in frames if target_flow and self.is_replay_rpc(frame)]
            if blocked:
                kept = [frame for frame in frames if frame not in blocked]
                message.content = "\n".join(json.dumps(frame) for frame in kept).encode()
                if not kept:
                    message.drop()
                replies = [{"id": frame["id"], "result": {"data": self.rpc_result(frame)}}
                           for frame in blocked if "id" in frame]
                if replies:
                    ctx.master.commands.call("inject.websocket", flow, True,
                                             "\n".join(json.dumps(reply) for reply in replies).encode(), True)
        else:
            channels = self.subscriptions.setdefault(flow.id, (flow, set()))[1]
            pending = self.pending_subscriptions.setdefault(flow.id, {})
            for frame in frames:
                command_id = frame.get('id') if isinstance(frame.get('id'), int) else None
                if command_id in pending:
                    channel = pending.pop(command_id)
                    if 'error' not in frame and isinstance(frame.get('result'), dict):
                        channels.add(channel)
                    else:
                        channels.discard(channel)
                result = frame.get('result')
                if ('id' not in frame and isinstance(result, dict) and result.get('type') == 3
                        and isinstance(result.get('channel'), str)):
                    channel = result.get('channel')
                    channels.discard(channel)
                    for command_id in [command_id for command_id, target in pending.items() if target == channel]:
                        pending.pop(command_id)
            if self.room_id:
                # 实际服务仍保持等待状态；丢弃其游戏推送，防止覆盖正在截图的固定对局。
                kept = [frame for frame in frames if not self.is_replay_publication(frame)]
                message.content = "\n".join(json.dumps(frame) for frame in kept).encode()
                if not kept:
                    message.drop()

    def websocket_end(self, flow):
        self.subscriptions.pop(flow.id, None)
        self.pending_subscriptions.pop(flow.id, None)

    def is_replay_rpc(self, frame):
        if frame.get("method") != 9:
            return False
        params = frame.get("params") or {}
        data = params.get("data") if isinstance(params, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get('path'), str):
            return False
        if re.match(rf"/v\d+/texas_holdem/room/{self.room_id}(?:/|$)", data['path']):
            return True
        if re.match(rf"/v1/chat_room/{self.room_id}(?:/|$)", data['path']):
            return True
        body = data.get('json') or {}
        action = body.get('action_url') if isinstance(body, dict) else None
        if data['path'] != '/v3/pay_action/do' or data.get('method') != 'POST' or not isinstance(action, dict):
            return False
        allowed = (
            ('PUT', '/v10/texas_holdem/room/$room_id$/game/$game_id$/check_community_card'),
            ('POST', '/v10/texas_holdem/room/$room_id$/game/$game_id$/operating_time'),
        )
        return action.get('room_id') == self.room_id and (action.get('method'), action.get('path')) in allowed

    def rpc_result(self, frame):
        error = self.ui_states.rpc_result(frame) if self.ui_states else None
        if error is not None:
            return error
        path = frame['params']['data']['path']
        if path.startswith(f'/v1/chat_room/{self.room_id}/'):
            return {'ok': True, 'result': {
                'users': [self.self_id] if self.self_id else [], 'user_id': self.self_id,
                'can_audio': True, 'can_video': True, 'has_joined': path.endswith('/join')}}
        # 支付夹具不扣钻；操作结果仍遵守应用的经验/升级协议。
        props = {'add_level_experience': 12}
        if path.endswith('/call'):
            props['level_up'] = {'new_level': 6}
        return {'ok': True, 'result': {
            **props, 'community_card': ['ah', 'kd', '7c', '2s', 'qs']}}

    def profile(self, player_id):
        return {"user_id": player_id, "nickname": "TestPlayer" if player_id == self.self_id else
                f"Player{TABLE_PLAYER_IDS.index(player_id) + 1}", "avatar_path": "", "gender": "male",
                "bio": "TestPlayer", "user_level": {"App:coin": {"level": 5, "progress": 0.5}},
                "last_used_nickname": ""}

    def http_fixture(self, path, body=b""):
        if not self.room_id:
            return None
        identifiers = TABLE_PLAYER_IDS
        if path == '/v10/profile/users':
            requested = json.loads(body).get('users', [])
            if requested and all(identifier in identifiers for identifier in requested):
                return {identifier: self.profile(identifier) for identifier in requested}
            return None
        statistics = re.fullmatch(rf"/v1/texas_statistics/player/({UUID})/rounds/(100|1000)", path)
        if statistics:
            player_id, rounds = statistics.groups()
            own_created_room = player_id == self.self_id and self.self_statistics_authorized()
            if player_id not in identifiers and not own_created_room:
                return None
            if own_created_room:
                self.self_statistics_responses += 1
            # Only this read-only statistics endpoint includes the current
            # created room's self. Identity, profile, wallet and mutations keep
            # their existing real-server behavior in the addon method guard.
            return {"total_hands": int(rounds), "vpip": 0.25, "pfr": 0.18,
                    "af": 2.5, "c_bet": 0.6, "fold_to_c_bet": 0.4, "fold_to_steal": 0.5,
                    "fold_to_three_bet": 0.5, "steal": 0.3, "three_bet": 0.08,
                    "win_rate": 0.2, "win_rate_vp": 0.3, "win_rate_wtsd": 0.5, "wtsd": 0.3}
        player_id = next((identifier for identifier in identifiers if identifier in path), None)
        if not player_id:
            return None
        if re.fullmatch(rf"/v10/profile/{UUID}", path):
            return self.profile(player_id)
        if re.fullmatch(rf"/v10/wallet/{UUID}/currency/coin", path):
            return {"balance": 12345}
        return None
