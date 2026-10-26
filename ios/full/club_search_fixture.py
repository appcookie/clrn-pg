"""为原生俱乐部搜索命中用例提供限于指定关键字和编号的只读响应。"""

import json
from urllib.parse import parse_qs, urlsplit


CLUB_SEARCH_KEYWORD = 'VisualClubSearch'
CLUB_SEARCH_ID = '12f2cb6e-9045-4910-b58a-7d3903f56a39'
CLUB_SEARCH_RESULT = {
    'id': CLUB_SEARCH_ID,
    'club_no': '12345678',
    'name': '搜索测试俱乐部',
    'area': '测试地区',
    'member_count': 7,
    'description': '用于验证搜索结果的固定俱乐部',
    'owner_id': 'visual-club-owner',
    'admin_ids': [],
}


class ClubSearchFixture:
    """只在用例打开搜索页后启用，避免拦截应用初始化时的俱乐部读取。"""

    def __init__(self):
        self.active = False
        self.search_requests = 0
        self.details_requests = 0

    def configure(self, active):
        if not isinstance(active, bool):
            raise ValueError('代理配置必须提供布尔值 active')
        self.active = active
        self.search_requests = 0
        self.details_requests = 0

    def status(self):
        return {'active': self.active, 'searchRequests': self.search_requests,
                'detailsRequests': self.details_requests}

    def response_for(self, request):
        if not self.active or not (request.host == 'api.shafayouxi.org'
                or request.host.endswith('.api.staging.laiwan.shafayouxi.com')):
            return None
        url = urlsplit(request.path)
        if url.path == '/v10/club/search' and request.method == 'GET':
            keyword = parse_qs(url.query, keep_blank_values=True).get('keyword')
            if keyword == [CLUB_SEARCH_KEYWORD]:
                self.search_requests += 1
                return {'ok': True, 'result': [CLUB_SEARCH_ID]}
        if url.path == '/v10/clubs' and request.method == 'PUT':
            try:
                body = json.loads(request.content)
            except (ValueError, TypeError):
                return None
            if body == {'club_ids': [CLUB_SEARCH_ID]}:
                self.details_requests += 1
                return {'ok': True, 'result': [CLUB_SEARCH_RESULT]}
        return None
