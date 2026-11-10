"""HTTP 失败的固定枚举；只检查传输元数据，绝不导出错误文本或业务正文。"""
import re
from datetime import datetime, timezone
from mitmproxy.flow import Error


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def outcome(flow):
    server = flow.server_conn
    mocked = flow.metadata.get('ios_mocked') is True
    response_source = 'none' if flow.response is None else 'fixture' if mocked else 'upstream'
    category, reason = 'none', None
    if flow.error:
        # mitmproxy 12.2.3 exposes a message, not the internal HTTP ErrorCode.
        # Match only known transport signatures; unknown errors stay unknown.
        message = flow.error.msg
        number = re.match(r'\[Errno (-?\d{1,3})\] ', message)
        reason = {61: 'connection-refused', 111: 'connection-refused',
                  60: 'connect-timeout', 110: 'connect-timeout',
                  8: 'dns', -2: 'dns', -3: 'dns'}.get(int(number[1])) if number else None
        tls_side = flow.metadata.get('ios_tls_failure_side')
        if message == Error.KILLED_MESSAGE:
            category = 'proxy-abort'
        elif tls_side in ('client', 'server'):
            category = f'{tls_side}-tls'
        elif message.startswith('Certificate verify failed:'):
            category, reason = 'server-tls', 'certificate-verify-failed'
        elif message == 'Client disconnected.':
            category = 'client-disconnect'
        elif message == 'server closed connection':
            category = 'upstream-disconnect'
        elif message.startswith(('HTTP/1 protocol error:', 'HTTP/2 protocol error:')):
            category = 'http-protocol'
        elif (server.error or reason is not None
              or (server.via and (message.startswith('Error connecting to ')
                                 or message.startswith('Upstream proxy ')))):
            category = 'proxy-connection' if server.via else 'upstream-connection'
        else:
            category = 'unknown'
        reason = disconnect_reason(message, reason)
    elif flow.response is not None and flow.response.status_code >= 400:
        category = 'fixture-http' if mocked else 'upstream-http'
    return dict(responseSource=response_source, failureCategory=category, failureReason=reason,
        fixtureLookupFailed=flow.metadata.get('ios_fixture_failure') is True,
        serverTcpEstablished=server.timestamp_tcp_setup is not None,
        serverTlsEstablished=server.tls_established, viaProxy=server.via is not None)


def disconnect_reason(message, reason):
    if message == 'server closed connection':
        return 'peer-closed'
    if message == 'connection cancelled':
        return 'connection-cancelled'
    return reason


def unknown_error_evidence(flow, category):
    """固定 mitmproxy HTTP/2 模板分类；不导出任意错误文本或帧数据。"""
    try:
        if category != 'unknown':
            return {}
        return unknown_signature(flow.error.msg)
    except Exception:
        return {}  # Diagnostics must preserve the original HTTP error.


def unknown_signature(message):
    signature = 'unrecognized'
    if re.fullmatch(r'stream reset by client \([A-Z_0-9]+\)', message):
        signature = 'http2-stream-reset'
    elif message.startswith('HTTP/2 connection closed: '):
        signature = 'http2-connection-closed'
    elif message == 'peer closed connection':
        signature = 'peer-closed'
    elif message == 'connection cancelled':
        signature = 'connection-cancelled'
    number = re.match(r'\[Errno (-?\d{1,3})\] ', message)
    return dict(unknownErrorSignature=signature,
        connectionReset=bool(number and int(number[1]) in (54, 104)))
