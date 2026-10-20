"""确保展示稳定化不会伪造认证、掩盖错误或修改其他用户。"""

import copy
import unittest
from presentation import AccountPresentation, LOGIN_PATH


class PresentationTests(unittest.TestCase):
    def test_login_preserves_identity_and_tokens(self):
        presentation = AccountPresentation()
        body = {'ok': True, 'result': {'user_id': 'self', 'username': 'real',
            'api_token': {'access_token': 'real-token'}, 'has_password': True}}
        self.assertTrue(presentation.normalize(LOGIN_PATH, 'POST', body))
        self.assertEqual(body['result']['user_id'], 'self')
        self.assertEqual(body['result']['api_token'], {'access_token': 'real-token'})
        self.assertTrue(body['result']['has_password'])
        profile = {'ok': True, 'result': {'nickname': 'real', 'created_at': '2026-10-01'}}
        original = copy.deepcopy(profile)
        self.assertFalse(presentation.normalize('/v10/profile/other', 'GET', profile))
        self.assertEqual(profile, original)
        self.assertTrue(presentation.normalize('/v10/profile/self', 'GET', profile))

    def test_failures_and_contract_changes_are_never_replaced(self):
        presentation = AccountPresentation()
        for body in ({'ok': False, 'error_type': 'invalid_password'}, {'ok': True, 'result': []},
                     {'ok': True, 'result': {'username': 'missing-identity'}}):
            original = copy.deepcopy(body)
            self.assertFalse(presentation.normalize(LOGIN_PATH, 'POST', body))
            self.assertEqual(body, original)
            self.assertIsNone(presentation.user_id)


if __name__ == '__main__':
    unittest.main()
