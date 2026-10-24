"""Local sink for docs/capture/hooks.js.

Run `python3 collector.py ./out`, open http://127.0.0.1:8765/ in Chrome and press OPEN.
The Notion tab it opens can postMessage to this page (Notion's CSP blocks fetches to
localhost), and this page writes each event to ./out as one JSON file.
"""
import http.server, sys, os, time
OUT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); body = self.rfile.read(n)
        name = self.path.strip('/').replace('/', '_') or 'dump'
        with open(os.path.join(OUT, f'{name}-{int(time.time()*1000)}.json'), 'wb') as f: f.write(body)
        self.send_response(200); self._cors(); self.end_headers(); self.wfile.write(b'ok')
    def do_GET(self):
        page = b"""<!doctype html><title>collector</title><p id=n>0</p><button id=go style="font-size:40px" onclick="window.__w=window.open('https://app.notion.com/p/4036b88487a680469894ddba3101056c','notiontarget')">OPEN</button><script>
let n=0; window.addEventListener('message', async e => { if(!String(e.origin).endsWith('notion.com')) return;
 await fetch('/'+(e.data.name||'dump'), {method:'POST', body: e.data.body}); document.getElementById('n').textContent=++n; });
</script>"""
        self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers(); self.wfile.write(page)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
