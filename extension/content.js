(() => {
  const host = location.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const NAMES = { 'youtube.com': 'YouTube', 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'x.com': 'X', 'twitter.com': 'X',
    'reddit.com': 'Reddit', 'linkedin.com': 'LinkedIn', 'tiktok.com': 'TikTok', 'localhost': 'Test' };
  const key = Object.keys(NAMES).find(k => host === k || host.endsWith('.' + k)) || host;
  const site = NAMES[key] || host;
  const WINDOW_MS = window.__SCROLLNUDGE_WINDOW_MS || 10000;

  let acc, lastDir = 0, lastY = window.scrollY, start = Date.now(), open = false, wrapEl = null;
  const reset = () => { acc = { wheel_px: 0, page_px: 0, scroll_events: 0, reversals: 0, clicks: 0, keys: 0 }; };
  reset();

  const dir = d => {
    const s = Math.sign(d);
    if (s && lastDir && s !== lastDir) acc.reversals++;
    if (s) lastDir = s;
  };
  addEventListener('wheel', e => {
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    acc.wheel_px += Math.abs(e.deltaY) * k;
    acc.scroll_events++;
    dir(e.deltaY);
  }, { passive: true, capture: true });
  addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y !== lastY) {
      acc.page_px += Math.abs(y - lastY);
      dir(y - lastY);
      lastY = y;
    }
  }, { passive: true, capture: true });
  addEventListener('click', e => { if (!wrapEl || e.target !== wrapEl) acc.clicks++; }, true);
  addEventListener('keydown', () => { acc.keys++; }, true);

  function send(msg) {
    try { return chrome.runtime.sendMessage(msg); } catch (e) { return Promise.resolve({ action: 'none' }); }
  }

  function card(html, wire) {
    if (open) return;
    open = true;
    const wrap = document.createElement('div');
    wrapEl = wrap;
    wrap.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = wrap.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .c{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#111;border:1px solid #ccc;border-radius:12px;
         box-shadow:0 6px 24px rgba(0,0,0,.18);padding:16px;width:300px}
      .t{font-weight:600;margin:0 0 6px}.s{color:#555;margin:0 0 12px;font-size:13px}
      .row{display:flex;gap:6px;flex-wrap:wrap}
      button{font:inherit;border:1px solid #bbb;background:#f6f6f6;color:#111;border-radius:8px;padding:6px 10px;cursor:pointer}
      button:hover{background:#eaeaea}.p{background:#111;color:#fff;border-color:#111}.p:hover{background:#333}
      .scale button{width:44px}.lbl{display:flex;justify-content:space-between;font-size:11px;color:#666;margin-top:4px;width:244px}
      .x{background:none;border:none;color:#777;padding:4px 0;margin-top:8px;font-size:12px}
    </style><div class="c">${html}</div>`;
    document.documentElement.appendChild(wrap);
    const close = () => { wrap.remove(); open = false; wrapEl = null; };
    wire(root, close);
    return close;
  }

  function prompt(token) {
    let done = false;
    const close = card(`<p class="t">Quick check-in</p><p class="s">How intentional is your scrolling right now?</p>
      <div class="row scale">${[1, 2, 3, 4, 5].map(n => `<button data-v="${n}">${n}</button>`).join('')}</div>
      <div class="lbl"><span>Mindless</span><span>On purpose</span></div>
      <button class="x" data-v="skip">Skip</button>`, (root, close) => {
      root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        done = true;
        send({ type: 'event', kind: b.dataset.v === 'skip' ? 'prompt_skip' : 'prompt_answer', value: b.dataset.v, site, token });
        close();
      }));
    });
    setTimeout(() => {
      if (!done && close) { send({ type: 'event', kind: 'prompt_timeout', value: '', site, token }); close(); }
    }, 60000);
  }

  function nudge(minutes, token) {
    let done = false;
    const close = card(`<p class="t">You've been on ${site} for ${minutes} minutes.</p><p class="s">Still scrolling on purpose?</p>
      <div class="row"><button data-v="continue">Yes, continue</button><button class="p" data-v="break">Take a break</button></div>`, (root, close) => {
      root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        done = true;
        send({ type: 'event', kind: 'nudge_response', value: b.dataset.v, site, token });
        if (b.dataset.v === 'break') {
          root.querySelector('.c').innerHTML = '<p class="t">Nice.</p><p class="s">Close this tab whenever you are ready.</p>';
          setTimeout(close, 4000);
        } else close();
      }));
    });
    setTimeout(() => {
      if (!done && close) { send({ type: 'event', kind: 'nudge_response', value: 'ignored', site, token }); close(); }
    }, 60000);
  }

  setInterval(async () => {
    const now = Date.now();
    const visible = document.visibilityState === 'visible' && document.hasFocus();
    const msg = { type: 'window', site, t_end: now, dur_ms: now - start, visible, busy: open, ...acc };
    start = now;
    reset();
    const r = await send(msg);
    if (!r || open) return;
    if (r.action === 'nudge') nudge(r.minutes, r.token);
    else if (r.action === 'prompt') prompt(r.token);
  }, WINDOW_MS);
})();
