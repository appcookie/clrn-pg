"""五个真实 mitmdump 入口连接本机上游，离线验证响应覆盖和插件加载。"""

import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PROXY_HOST = '64.kr-seoul.api.staging.laiwan.shafayouxi.com'
OTHER_HOST = '67.hk.api.staging.laiwan.shafayouxi.com'
METADATA_PATH = '/public/v13/metadata/servers'

ROOT = Path(__file__).resolve().parents[2]


class Upstream(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == METADATA_PATH:
            servers = {PROXY_HOST: 'real-address', OTHER_HOST: 'another-address'}
            if url.query == 'changed':
                servers = {'new-node': 'new-address'}
            body = {'ok': True, 'new_envelope': 42, 'result': {'servers': servers, 'new_field': True}}
        else:
            body = {'backend_delay': 37, 'server_load': 'normal', 'new_health': True}
        status = 503 if url.query == 'failed' else 200
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Upstream', 'real')
        self.send_header('Access-Control-Allow-Origin', 'https://app.test')
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('X-Upstream', 'real-preflight')
        self.end_headers()

    def log_message(self, *_args):
        pass


class LiveOverrideTests(unittest.TestCase):
    def test_all_addons_preserve_live_upstream_responses(self):
        upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        worker = threading.Thread(target=upstream.serve_forever, daemon=True)
        worker.start()
        try:
            for addon in ('e2e/mitmproxy/network_faults.py',
                          'visual/cases/texas-holdem/mitmproxy/addon.py',
                          'visual/cases/zhajinhua/mitmproxy/addon.py',
                          'visual/cases/game-record/mitmproxy/addon.py',
                          'visual/cases/club/mitmproxy/addon.py'):
                with self.subTest(addon=addon):
                    self.check_addon(upstream.server_port, addon)
        finally:
            upstream.shutdown()
            upstream.server_close()
            worker.join(timeout=5)

    def check_addon(self, upstream_port, addon):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        executable = Path(sys.executable).with_name('mitmdump')
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile() as logs:
            process = subprocess.Popen([str(executable), '--listen-host', '127.0.0.1',
                '--listen-port', str(port), '--mode', f'upstream:http://127.0.0.1:{upstream_port}',
                '--set', f'confdir={directory}', '--set', 'connection_strategy=lazy',
                '--set', 'flow_detail=0', '-s', str(ROOT / addon)],
                env={**os.environ, 'MITMPROXY_CONTROL_TOKEN': 'offline-token'}, stdout=logs, stderr=logs)
            try:
                deadline = time.monotonic() + 15
                while True:
                    try:
                        status, _, _ = self.fetch(port, 'http://test-mitmproxy.invalid/status')
                        self.assertEqual(status, 200)
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            logs.seek(0)
                            self.fail('mitmdump startup failed: ' + logs.read().decode()[-2000:])
                        time.sleep(0.1)
                self.fetch(port, 'http://test-mitmproxy.invalid/scenario', 'POST', {'scenario': 'visual-stable'})
                metadata = 'http://api.shafayouxi.org' + METADATA_PATH
                status, headers, body = self.fetch(port, metadata)
                self.assertEqual(status, 200)
                self.assertEqual(body, {'ok': True, 'new_envelope': 42, 'result': {
                    'servers': {PROXY_HOST: 'real-address', OTHER_HOST: 'another-address'}, 'new_field': True}})
                self.assertEqual(headers['x-upstream'], 'real')
                self.assertEqual(headers['access-control-allow-origin'], 'https://app.test')
                self.assertEqual(self.fetch(port, metadata + '?failed')[0], 503)
                self.assertEqual(self.fetch(port, metadata + '?changed')[2]['result']['servers'],
                                 {'new-node': 'new-address'})
                health = f'http://{PROXY_HOST}/node/v1/status'
                self.assertEqual(self.fetch(port, health)[2], {
                    'backend_delay': 37, 'server_load': 'normal', 'new_health': True})
                self.assertEqual(self.fetch(port, health + '?failed')[0], 503)
                alternate = f'http://{OTHER_HOST}/node/v1/status'
                self.assertEqual(self.fetch(port, alternate)[2], {
                    'backend_delay': 37, 'server_load': 'normal', 'new_health': True})
                self.assertEqual(self.fetch(port, alternate + '?failed')[0], 503)
                for url in (metadata, health, alternate):
                    status, headers, _ = self.fetch(port, url, 'OPTIONS')
                    self.assertEqual(status, 204)
                    self.assertEqual(headers['x-upstream'], 'real-preflight')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

    def fetch(self, port, url, method='GET', body=None):
        client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            client.request(method, url, None if body is None else json.dumps(body),
                           {'X-E2E-Control-Token': 'offline-token', 'Content-Type': 'application/json'})
            response = client.getresponse()
            raw = response.read()
            return response.status, {key.lower(): value for key, value in response.getheaders()}, json.loads(raw) if raw else None
        finally:
            client.close()


if __name__ == '__main__':
    unittest.main()
