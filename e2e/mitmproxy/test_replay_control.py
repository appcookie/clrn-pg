"""No captured subscriptions, room IDs, payloads or credentials enter diagnostics."""
import json
from types import SimpleNamespace
import unittest
from replay_control import replay_readiness, replay_error

ROOM = '00000000-0000-4000-8000-000000000001'
OTHER = '00000000-0000-4000-8000-000000000002'
SELF = '00000000-0000-4000-8000-000000000003'


class ReplayControlTests(unittest.TestCase):
    def test_only_live_server_confirmed_exact_room_channels_are_ready(self):
        for game in ('texas_holdem', 'zhajinhua'):
            replay = SimpleNamespace(room_id=ROOM, subscriptions={}, pending_subscriptions={})
            channel = f'{game}>{ROOM}#{SELF}'
            flow = SimpleNamespace(websocket=SimpleNamespace(timestamp_end=None))
            replay.subscriptions['live'] = (flow, set())
            replay.pending_subscriptions['live'] = {1: channel}
            pending = replay_readiness(replay, game, ROOM)
            self.assertEqual([pending[k] for k in ('ready', 'liveConnections', 'confirmedSubscriptions', 'pendingSubscriptions')],
                             [False, 1, 0, 1])
            replay.subscriptions['live'][1].update((f'{game}>{OTHER}#{SELF}', channel + '/extra'))
            self.assertFalse(replay_readiness(replay, game, ROOM)['ready'])
            replay.subscriptions['live'][1].add(channel)
            replay.pending_subscriptions.clear()
            self.assertTrue(replay_readiness(replay, game, ROOM)['ready'])
            self.assertEqual(len(replay.subscriptions['live'][1]), 3, 'readiness never mutates channels')
            flow.websocket.timestamp_end = 1
            self.assertFalse(replay_readiness(replay, game, ROOM)['ready'])
            for invalid in (None, {}, OTHER, ROOM + '#injection'):
                with self.assertRaises(ValueError):
                    replay_readiness(replay, game, invalid)

    def test_errors_have_fixed_codes_utc_and_counts_without_untrusted_content(self):
        replay = SimpleNamespace(room_id=ROOM, subscriptions={}, pending_subscriptions={})
        for message, code in [('No subscribed Texas room', 'room_not_subscribed'),
                              ('No subscribed Zhajinhua room', 'room_not_subscribed'),
                              ('secret-token ' + ROOM, 'invalid_command')]:
            result = replay_error(ValueError(message), replay, 'texas_holdem',
                                  {'roomId': ROOM, 'token': 'secret-token'})
            self.assertEqual(result['errorCode'], code)
            self.assertEqual(result['confirmedSubscriptions'], 0)
            self.assertRegex(result['sampledAtUtc'], r'^\d{4}-\d{2}-\d{2}T.*\+00:00$')
            for secret in (ROOM, SELF, 'secret-token'):
                self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn('confirmedSubscriptions', replay_error(TypeError('secret'), replay, 'texas_holdem', []))
