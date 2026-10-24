// Paste into the DevTools console of a Notion tab opened from collector.py's OPEN button.
// Wraps fetch, XHR and WebSocket.send so every API call (including direct S3 uploads) and every websocket frame
// (both directions) is posted to the collector page. Cookies and auth headers are dropped.
// mark('label') inserts a marker so the timeline shows which action caused which traffic.
(() => {
  const send = (name, obj) => { try { window.opener.postMessage({ name, body: JSON.stringify(obj) }, '*'); } catch (e) {} };
  const headers = (h) => { const o = {}; try { new Headers(h || {}).forEach((v, k) => { if (!/cookie|authorization|token/i.test(k)) o[k] = v; }); } catch (e) {} return o; };

  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const res = await realFetch.apply(this, arguments);
    if (!/\/_assets\/|\.(js|css)$/.test(url)) {
      res.clone().text().then((body) => send('http', {
        t: Date.now(), url: url.split('?')[0], q: url.split('?')[1] || '',
        method: (init && init.method) || 'GET', reqHeaders: headers(init && init.headers), req: init && typeof init.body === 'string' ? init.body : init && init.body ? '[binary body]' : null, status: res.status, res: body,
      })).catch(() => {});
    }
    return res;
  };

  const open = XMLHttpRequest.prototype.open, xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__url = u; this.__method = m; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    this.addEventListener('load', () => send('http', {
      t: Date.now(), method: this.__method, url: String(this.__url).split('?')[0], xhr: true, status: this.status,
      req: typeof b === 'string' ? b : b ? '[binary body]' : null,
      res: this.responseType === '' || this.responseType === 'text' ? this.responseText : `[${this.responseType}]`,
    }));
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
