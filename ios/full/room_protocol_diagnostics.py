"""Bounded room protocol evidence; never export IDs, channels, paths or bodies."""
from collections import OrderedDict, deque
import re


def request_kind(frame):
    params = frame.get('params')
    if not isinstance(params, dict):
        return None
    if frame.get('method') in (1, 2) and str(params.get('channel', '')).startswith(('zhajinhua>', 'texas_holdem>')):
        return 'subscribe' if frame['method'] == 1 else 'unsubscribe'
    data = params.get('data')
    if frame.get('method') != 9 or not isinstance(data, dict):
        return None
    path = data.get('path')
    if not isinstance(path, str) or not re.fullmatch(r'/v\d+/(?:zhajinhua|texas_holdem)/room/[0-9a-f-]{36}/.+', path, re.I):
        return None
    return 'alive' if path.endswith('/player/alive') else 'room-rpc'


class RoomProtocolDiagnostics:
    def __init__(self):
        self.pending = OrderedDict()
        self.events = deque(maxlen=64)

    def observe(self, frame, from_client, now):
        if from_client:
            self.request(frame, now)
        else:
            self.response(frame, now)

    def request(self, frame, now):
        kind = request_kind(frame)
        if kind is None:
            return
        self.events.append(dict(kind=kind, stage='request', at=now))
        command_id = frame.get('id')
        if type(command_id) is int:
            self.pending[command_id] = kind
            if len(self.pending) > 64:
                self.pending.popitem(last=False)

    def response(self, frame, now):
        kind = self.pending.pop(frame.get('id'), None)
        if kind is not None:
            event = dict(kind=kind, stage='response', at=now, protocolError='error' in frame)
            result = frame.get('result')
            data = result.get('data') if isinstance(result, dict) else None
            if isinstance(data, dict) and type(data.get('ok')) is bool:
                event['applicationOk'] = data['ok']
            self.events.append(event)
        result = frame.get('result')
        if (isinstance(result, dict) and result.get('type') == 3
                and str(result.get('channel', '')).startswith(('zhajinhua>', 'texas_holdem>'))):
            self.events.append(dict(kind='server-unsubscribe', stage='push', at=now))

    def snapshot(self, now):
        return [{key: value for key, value in event.items() if key != 'at'}
                | {'agoMs': round(max(0, now - event['at']) * 1000)} for event in self.events]
