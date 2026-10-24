"""Authenticated replay diagnostics contain fixed codes/counts, never identities or payloads."""

from datetime import datetime, timezone
import re

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
ERROR_CODES = {
    'Invalid replay': 'invalid_replay',
    'Another room already owns this replay': 'room_mismatch',
    'Replay requires this test room': 'room_not_created',
    'No subscribed Texas room': 'room_not_subscribed',
    'No subscribed Zhajinhua room': 'room_not_subscribed',
    'Unknown command': 'unknown_command',
    'Invalid replay readiness': 'invalid_readiness',
}


def replay_readiness(replay, game, room_id):
    """Read only server-confirmed channels on live flows for this exact room."""
    if (not isinstance(room_id, str) or not re.fullmatch(UUID, room_id, re.I)
            or (replay.room_id and room_id != replay.room_id)):
        raise ValueError('Invalid replay readiness')
    channel_pattern = rf'{game}>{room_id}#{UUID}'
    live = confirmed = pending = 0
    for flow_id, (flow, channels) in replay.subscriptions.items():
        if flow.websocket.timestamp_end is not None:
            continue
        room_channels = sum(bool(re.fullmatch(channel_pattern, channel, re.I)) for channel in channels)
        room_pending = sum(bool(re.fullmatch(channel_pattern, channel, re.I))
                           for channel in replay.pending_subscriptions.get(flow_id, {}).values())
        live += int(bool(room_channels or room_pending))
        confirmed += room_channels
        pending += room_pending
    return {'ready': confirmed > 0, 'liveConnections': live,
            'confirmedSubscriptions': confirmed, 'pendingSubscriptions': pending,
            'sampledAtUtc': datetime.now(timezone.utc).isoformat(timespec='milliseconds')}


def replay_error(error, replay, game, body):
    """Never serialize exception text or the untrusted control request."""
    result = {'error': 'Invalid replay command',
              'errorCode': ERROR_CODES.get(str(error), 'invalid_command'),
              'sampledAtUtc': datetime.now(timezone.utc).isoformat(timespec='milliseconds')}
    try:
        state = replay_readiness(replay, game, body.get('roomId') if isinstance(body, dict) else None)
        result.update({key: state[key] for key in
                       ('liveConnections', 'confirmedSubscriptions', 'pendingSubscriptions')})
    except ValueError:
        pass
    return result
