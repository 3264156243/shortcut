#!/usr/bin/env python3
import hashlib
import json
import os
import random
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PORT = int(os.environ.get('PORT', '32642'))
APP_ID = os.environ.get('BAIDU_TRANSLATE_APP_ID', '')
SECRET = os.environ.get('BAIDU_TRANSLATE_SECRET', '')
LANGUAGES = {'auto', 'zh', 'en', 'jp', 'kor', 'fra', 'de', 'ru', 'spa', 'ara', 'th', 'it', 'pt', 'vie'}
BUCKETS = {}
BUCKET_LOCK = threading.Lock()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format_string, *args):
        return

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(204, {})

    def do_GET(self):
        self.reply(200, {'ok': True}) if self.path == '/health' else self.reply(404, {'success': False, 'error': 'Not found'})

    def do_POST(self):
        if self.path != '/translate':
            return self.reply(404, {'success': False, 'error': 'Not found'})
        if not APP_ID or not SECRET:
            return self.reply(503, {'success': False, 'error': '翻译服务尚未配置'})
        if not self.allow_request():
            return self.reply(429, {'success': False, 'error': '请求过于频繁，请稍后再试'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 20000:
                return self.reply(400, {'success': False, 'error': '请求内容无效'})
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            text = str(body.get('text', '')).strip()
            source = str(body.get('from', 'auto'))
            target = str(body.get('to', 'zh'))
            if not text:
                return self.reply(400, {'success': False, 'error': '翻译内容不能为空'})
            if len(text.encode('utf-8')) > 6000:
                return self.reply(400, {'success': False, 'error': '单次翻译内容不能超过 6000 字节'})
            if source not in LANGUAGES or target not in LANGUAGES or target == 'auto':
                return self.reply(400, {'success': False, 'error': '不支持的语言类型'})
            self.reply(200, translate(text, source, target))
        except Exception as error:
            self.reply(502, {'success': False, 'error': str(error) or '翻译服务请求失败'})

    def allow_request(self):
        address = self.client_address[0]
        now = time.time()
        with BUCKET_LOCK:
            started, count = BUCKETS.get(address, (now, 0))
            if now - started > 60:
                started, count = now, 0
            count += 1
            BUCKETS[address] = (started, count)
            return count <= 60

def translate(text, source, target):
    salt = '{}{}'.format(int(time.time() * 1000), random.randint(1000, 9999))
    signature = hashlib.md5((APP_ID + text + salt + SECRET).encode('utf-8')).hexdigest()
    data = urlencode({'q': text, 'from': source, 'to': target, 'appid': APP_ID, 'salt': salt, 'sign': signature}).encode('utf-8')
    request = Request('https://fanyi-api.baidu.com/api/trans/vip/translate', data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode('utf-8'))
    if payload.get('error_code'):
        raise RuntimeError(payload.get('error_msg') or '百度翻译错误 {}'.format(payload.get('error_code')))
    return {'success': True, 'translatedText': '\n'.join(item.get('dst', '') for item in payload.get('trans_result', [])), 'from': payload.get('from'), 'to': payload.get('to')}

if __name__ == '__main__':
    server = ThreadedHTTPServer(('127.0.0.1', PORT), Handler)
    print('ShortCut translation proxy listening on 127.0.0.1:{}'.format(PORT), flush=True)
    server.serve_forever()