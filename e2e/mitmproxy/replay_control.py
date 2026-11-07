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


def valid_room_id(room_id):
    return isinstance(room_id, str) and re.fullmatch(UUID, room_id, re.I)


def owns_room(replay, room_id):
    return not replay.room_id or room_id == replay.room_id


def matching_channels(pattern, channels):
    return sum(bool(re.fullmatch(pattern, channel, re.I)) for channel in channels)


def live_room_counts(replay, pattern):
    for flow_id, (flow, channels) in replay.subscriptions.items():
        if flow.websocket.timestamp_end is not None:
            continue
        yield (matching_channels(pattern, channels),
               matching_channels(pattern, replay.pending_subscriptions.get(flow_id, {}).values()))


def connection_count(counts):
    confirmed, pending = counts
    return int(bool(confirmed or pending))


def room_readiness(counts):
    live = confirmed = pending = 0
    for count in counts:
        live += connection_count(count)
        confirmed += count[0]
        pending += count[1]
    return {'ready': confirmed > 0, 'liveConnections': live,
            'confirmedSubscriptions': confirmed, 'pendingSubscriptions': pending,
            'sampledAtUtc': datetime.now(timezone.utc).isoformat(timespec='milliseconds')}


def replay_readiness(replay, game, room_id):
    """Read only server-confirmed channels on live flows for this exact room."""
    if not valid_room_id(room_id) or not owns_room(replay, room_id):
        raise ValueError('Invalid replay readiness')
    return room_readiness(live_room_counts(replay, rf'{game}>{room_id}#{UUID}'))


def requested_room(body):
    return body.get('roomId') if isinstance(body, dict) else None


def diagnostic_counts(state):
    return {key: state[key] for key in
            ('liveConnections', 'confirmedSubscriptions', 'pendingSubscriptions')}


def replay_error(error, replay, game, body):
    """Never serialize exception text or the untrusted control request."""
    result = {'error': 'Invalid replay command',
              'errorCode': ERROR_CODES.get(str(error), 'invalid_command'),
              'sampledAtUtc': datetime.now(timezone.utc).isoformat(timespec='milliseconds')}
    try:
        result.update(diagnostic_counts(replay_readiness(replay, game, requested_room(body))))
    except ValueError:
        pass
    return result
