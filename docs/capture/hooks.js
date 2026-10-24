// Paste into the DevTools console of a Notion tab opened from collector.py's OPEN button.
// Wraps fetch, XHR and WebSocket.send so every /api/v3 call and every websocket frame
// (both directions) is posted to the collector page. Cookies and auth headers are dropped.
// mark('label') inserts a marker so the timeline shows which action caused which traffic.
(() => {
  const send = (name, obj) => { try { window.opener.postMessage({ name, body: JSON.stringify(obj) }, '*'); } catch (e) {} };
  const headers = (h) => { const o = {}; try { new Headers(h || {}).forEach((v, k) => { if (!/cookie|authorization|token/i.test(k)) o[k] = v; }); } catch (e) {} return o; };

  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const res = await realFetch.apply(this, arguments);
    if (url.includes('/api/v3/')) {
      res.clone().text().then((body) => send('http', {
        t: Date.now(), url: url.split('?')[0], q: url.split('?')[1] || '',
        reqHeaders: headers(init && init.headers), req: init && init.body, status: res.status, res: body,
      })).catch(() => {});
    }
    return res;
  };

  const open = XMLHttpRequest.prototype.open, xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__url = u; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    if (String(this.__url).includes('/api/v3/')) {
      this.addEventListener('load', () => send('http', { t: Date.now(), url: String(this.__url).split('?')[0], req: b, status: this.status, res: this.responseText, xhr: true }));
    }
    return xsend.apply(this, arguments);
  };

  // Sockets opened before this runs are picked up on their next send (Notion pings every ~25s).
  const wsSend = WebSocket.prototype.send, seen = new WeakSet();
  const frame = (d) => (typeof d === 'string' ? d : `[binary ${d.byteLength || d.size}]`);
  WebSocket.prototype.send = function (d) {
    const u = new URL(this.url), host = u.host + u.pathname;
    send('ws', { t: Date.now(), dir: 'out', host, d: frame(d) });
    if (!seen.has(this)) {
      seen.add(this);
      this.addEventListener('message', (e) => send('ws', { t: Date.now(), dir: 'in', host, d: frame(e.data) }));
    }
    return wsSend.apply(this, arguments);
  };

  window.mark = (label) => send('mark', { t: Date.now(), label });
  window.mark('hooks-installed');
})();
