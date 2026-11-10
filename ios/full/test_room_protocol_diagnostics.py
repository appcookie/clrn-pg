"""The released app sends room RPC paths without a leading slash."""
import json
import unittest
from room_protocol_diagnostics import RoomProtocolDiagnostics


class RoomProtocolTests(unittest.TestCase):
    def test_native_alive_path_and_reply_are_observed_without_mutation(self):
        for prefix in ('', '/'):
            for game in ('texas_holdem', 'zhajinhua'):
                with self.subTest(prefix=prefix, game=game):
                    diagnostic = RoomProtocolDiagnostics()
                    frame = {'id': 7, 'method': 9, 'params': {'data': {
                        'path': f'{prefix}v10/{game}/room/00000000-0000-4000-8000-000000000001/player/alive',
                        'json': {'private': 'private-body'}}}}
                    before = json.dumps(frame)
                    diagnostic.observe(frame, True, 1)
                    diagnostic.observe({'id': 7, 'result': {'data': {'ok': True}}}, False, 2)
                    self.assertEqual(json.dumps(frame), before)
                    events = diagnostic.snapshot(3)
                    self.assertEqual([event['kind'] for event in events], ['alive', 'alive'])
                    self.assertTrue(events[1]['applicationOk'])
                    self.assertNotIn('private', json.dumps(events))
                    self.assertNotIn('00000000', json.dumps(events))
