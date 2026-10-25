"""验证俱乐部搜索夹具只覆盖本例指定的只读请求。"""

import json
import unittest
from types import SimpleNamespace

from club_search_fixture import CLUB_SEARCH_ID, ClubSearchFixture


def request(path, method='GET', body=None, host='api.shafayouxi.org'):
    return SimpleNamespace(path=path, method=method, host=host,
                           content=json.dumps(body).encode() if body is not None else b'')


class ClubSearchFixtureTests(unittest.TestCase):
    def test_仅在启用后返回指定俱乐部并记录两段请求(self):
        fixture = ClubSearchFixture()
        search = request('/v10/club/search?keyword=VisualClubSearch')
        details = request('/v10/clubs', 'PUT', {'club_ids': [CLUB_SEARCH_ID]})
        self.assertIsNone(fixture.response_for(search))
        fixture.configure(True)
        self.assertEqual(fixture.response_for(search)['result'], [CLUB_SEARCH_ID])
        self.assertEqual(fixture.response_for(details)['result'][0]['name'], '搜索测试俱乐部')
        self.assertEqual(fixture.status(), {'active': True, 'searchRequests': 1, 'detailsRequests': 1})

    def test_其他关键字俱乐部和非测试服务保持透传(self):
        fixture = ClubSearchFixture()
        fixture.configure(True)
        for candidate in (
                request('/v10/club/search?keyword=other'),
                request('/v10/clubs', 'PUT', {'club_ids': ['other']}),
                request('/v10/club/search?keyword=VisualClubSearch', host='api.production.example.com'),
                request('/v10/club?user_id=real')):
            self.assertIsNone(fixture.response_for(candidate))
        self.assertEqual(fixture.status()['searchRequests'], 0)
        self.assertEqual(fixture.status()['detailsRequests'], 0)
        with self.assertRaises(ValueError):
            fixture.configure('true')


if __name__ == '__main__':
    unittest.main()
