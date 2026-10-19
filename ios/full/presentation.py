"""将成功响应中的展示字段固定为 Web 同款夹具；身份、令牌和错误保持真实。"""

import json
from pathlib import Path

PRESENTATION = json.loads((Path(__file__).resolve().parents[2]
    / 'visual/fixtures/account-presentation.json').read_text())
LOGIN_PATH = '/public/v10/user/login/username/password'


class AccountPresentation:
    def __init__(self):
        self.user_id = None

    def normalize(self, path, method, body):
        if not isinstance(body, dict) or body.get('ok') is not True:
            return False
        result = body.get('result')
        if not isinstance(result, dict):
            return False
        if path == LOGIN_PATH and method == 'POST':
            if not result.get('user_id') or not isinstance(result.get('api_token'), dict):
                return False
            self.user_id = result['user_id']
            if isinstance(result.get('username'), str):
                result['username'] = PRESENTATION['username']
                return True
        if not self.user_id:
            return False
        if method == 'GET' and path == f'/v10/profile/{self.user_id}':
            if not isinstance(result.get('nickname'), str) or not isinstance(result.get('created_at'), str):
                return False
            result['nickname'] = PRESENTATION['nickname']
            result['created_at'] = f"{PRESENTATION['joinedDate']}T12:00:00.000Z"
            return True
        if method == 'GET' and path == f'/v11/user/{self.user_id}/account':
            if isinstance(result.get('username'), str):
                result['username'] = PRESENTATION['username']
                return True
        if method == 'PUT' and path == f'/v10/wallet/{self.user_id}':
            currencies = result.get('currencies')
            if not isinstance(currencies, list) or not all(isinstance(item, dict) and 'balance' in item for item in currencies):
                return False
            for currency in currencies:
                currency['balance'] = PRESENTATION['balance']
            return True
        return False
