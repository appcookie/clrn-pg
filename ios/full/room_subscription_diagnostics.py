"""旁路读取德州订阅生命周期；不修改消息、回放登记或连接就绪条件。"""

from collections import deque
from datetime import datetime, timezone
import re

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'


def history(proxy):
    room = proxy.game_session.room['roomId']
    previous, events = getattr(proxy, '_room_subscription_events', (None, None))
    if previous != room:
        events = deque(maxlen=64)
        proxy._room_subscription_events = (room, events)
    return events


def observe(proxy, flow, ended=False):
    """在回放更新登记前观测；所有诊断异常均不得改变原始消息处理结果。"""
    try:
        if not proxy.game_session or proxy.game_session.game_type != 'texas_holdem' or not proxy.game_session.room:
            return
        replay = proxy.game.texas
        pending = dict(replay.pending_subscriptions.get(flow.id, {}))
        if ended:
            channels = replay.subscriptions.get(flow.id, (None, set()))[1]
            for channel in channels | set(pending.values()):
                record(proxy, 'connection-ended', channel)
            return
        message = flow.websocket.messages[-1]
        if not message.is_text or message.injected or len(message.content) > 256 * 1024:
            return
        for frame in proxy.websocket_frames(message)[:1000]:
            observe_frame(proxy, frame, message.from_client, pending)
    except Exception:
        pass


def observe_frame(proxy, frame, from_client, pending):
    if not isinstance(frame, dict):
        return
    params, result = frame.get('params'), frame.get('result')
    if from_client and isinstance(params, dict):
        event = {1: 'requested', 2: 'client-unsubscribe'}.get(frame.get('method'))
        if event:
            record(proxy, event, params.get('channel'))
        return
    command = frame.get('id')
    if command in pending:
        event = 'confirmed' if 'error' not in frame and isinstance(result, dict) else 'rejected'
        record(proxy, event, pending.pop(command), frame.get('error'))
    if 'id' not in frame and isinstance(result, dict) and result.get('type') == 3:
        record(proxy, 'server-unsubscribe', result.get('channel'), result.get('data'))


def record(proxy, event, channel, detail=None):
    room = proxy.game_session.room['roomId']
    if not isinstance(channel, str) or not re.fullmatch(rf'texas_holdem>{room}#{UUID}', channel, re.I):
        return
    entry = {'event': event, 'atUtc': datetime.now(timezone.utc).isoformat(timespec='milliseconds')}
    code = detail.get('code') if isinstance(detail, dict) else None
    if type(code) is int and 0 <= code <= 65535:
        entry['code'] = code
    history(proxy).append(entry)


def snapshot(proxy):
    try:
        return {'events': list(history(proxy))}
    except Exception:
        return {'eventsUnavailable': True}
