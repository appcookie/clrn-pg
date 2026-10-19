"""视觉代理只覆盖必要字段；真实错误、响应头和新增字段继续交给客户端。"""

import json
import logging
from urllib.parse import urlsplit
from mitmproxy import http

PROXY_HOST = '64.kr-seoul.api.staging.laiwan.shafayouxi.com'
METADATA_PATH = '/public/v13/metadata/servers'


def is_staging(host):
    return host == 'api.shafayouxi.org' or host.endswith('.api.staging.laiwan.shafayouxi.com')


def patch_result(flow, change):
    """change 原地修改成功响应的 result；结构变化时保留原文并提示，禁止兜底成功。"""
    if not flow.response or flow.response.status_code != 200:
        return False
    try:
        body = flow.response.json()
        if not isinstance(body, dict) or body.get('ok') is not True:
            return False
        result = body.get('result')
        if not isinstance(result, dict):
            raise ValueError('Expected result object')
        if not change(result):
            return False
        flow.response.content = json.dumps(body).encode()
        # 原响应的缓存校验值已失效，保留其他头（包括 CORS 和压缩编码）。
        for header in ('ETag', 'Content-MD5', 'Digest'):
            flow.response.headers.pop(header, None)
        return True
    except (ValueError, TypeError, KeyError, AttributeError):
        logging.warning('Visual override skipped: response contract changed at %s',
                        urlsplit(flow.request.path).path)
        return False


def patch_version(flow, version):
    def change(result):
        if not isinstance(result.get('available_url_version'), str):
            raise ValueError('Expected version string')
        result['available_url_version'] = version
        return True
    return patch_result(flow, change)


def prepare_profiles(flow, self_id, virtual_ids):
    """混合批次只向上游查询真实本人，虚拟 UUID 不会导致真实接口返回找不到用户。"""
    if (not isinstance(self_id, str) or not self_id or flow.request.method != 'PUT'
            or urlsplit(flow.request.path).path != '/v10/profile/users'):
        return False
    try:
        body = flow.request.json()
        users = body.get('users')
        if (not isinstance(users, list) or self_id not in users
                or not set(users) <= {self_id, *virtual_ids} or not set(users) & set(virtual_ids)):
            return False
        flow.metadata['visual_profile_users'] = users
        body['users'] = [self_id]
        flow.request.content = json.dumps(body).encode()
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def patch_profiles(flow, self_id, profiles):
    """混合批次从真实接口取得本人资料，仅补入回放虚拟玩家；其他账号批次透传。"""
    if (not isinstance(self_id, str) or not self_id or flow.request.method != 'PUT'
            or urlsplit(flow.request.path).path != '/v10/profile/users'):
        return False
    try:
        users = flow.metadata.get('visual_profile_users', flow.request.json().get('users'))
        if not isinstance(users, list) or self_id not in users or not set(users) <= {self_id, *profiles}:
            return False
    except (ValueError, TypeError, AttributeError):
        return False
    selected = {user: profile for user, profile in profiles.items() if user in users}
    if not selected:
        return False

    def change(result):
        # 本人资料缺失也不伪造；让客户端看到真实接口变化。
        if not isinstance(result.get(self_id), dict):
            raise ValueError('Missing current user profile')
        for user, profile in selected.items():
            result[user] = {**(result.get(user) or {}), **profile}
        return True
    return patch_result(flow, change)


class VisualNetwork:
    """只排除其他 staging 节点；选中节点的健康检查和 metadata 都访问真实上游。"""

    def request(self, flow):
        path = urlsplit(flow.request.path).path
        if (not is_staging(flow.request.host) or flow.request.host == PROXY_HOST
                or path != '/node/v1/status' or flow.request.method not in ('GET', 'OPTIONS')):
            return False
        preflight = flow.request.method == 'OPTIONS'
        flow.response = http.Response.make(204 if preflight else 503,
            b'' if preflight else b'{"server_load":"unavailable"}', {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': flow.request.headers.get('Origin', '*'),
                'Access-Control-Allow-Credentials': 'true', 'Vary': 'Origin',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': flow.request.headers.get('Access-Control-Request-Headers', ''),
            })
        return True

    def response(self, flow):
        if (not is_staging(flow.request.host) or flow.request.method != 'GET'
                or urlsplit(flow.request.path).path != METADATA_PATH):
            return False

        def change(result):
            servers = result.get('servers')
            if not isinstance(servers, dict) or PROXY_HOST not in servers:
                raise ValueError('Selected node missing from metadata')
            if len(servers) == 1:
                return False
            result['servers'] = {PROXY_HOST: servers[PROXY_HOST]}
            return True
        return patch_result(flow, change)
