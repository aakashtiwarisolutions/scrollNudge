const WINDOW_GAP_MS = 3 * 60 * 1000;
const BASELINE_DAYS = 7;
const EXPERIMENT_DAYS = 14;
const MIN_NUDGE_MIN = 5;
const NUDGE_COOLDOWN_MS = 10 * 60 * 1000;
const RECENT = 12;
const FEATURES = ['elapsed_min', 'speed_2m', 'clicks_pm', 'reversals_pm', 'pause_frac', 'hour_sin', 'hour_cos', 'since_last_min'];

let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn, fn));

function localDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayIndex(start, t) {
  const a = new Date(start + 'T12:00:00');
  const b = new Date(localDate(t) + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}
function shuffle(a) {
  const r = new Uint32Array(a.length);
  crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function newStudy(t) {
  const half = EXPERIMENT_DAYS / 2;
  const exp = shuffle([...Array(half).fill('nudge'), ...Array(half).fill('control')]);
  return { startDate: localDate(t), schedule: [...Array(BASELINE_DAYS).fill('baseline'), ...exp], model: null, created: t };
}
function condition(study, t) {
  const i = dayIndex(study.startDate, t);
  if (i < 0 || i >= study.schedule.length) return { day: i, cond: 'after' };
  return { day: i, cond: study.schedule[i] };
}

async function load() {
  const s = await chrome.storage.local.get(['study', 'rt']);
  let study = s.study;
  if (!study) {
    study = newStudy(Date.now());
    await chrome.storage.local.set({ study });
  }
  const rt = s.rt || { sessions: {}, recent: {}, lastPrompt: 0, nextPromptGap: 10 * 60000, lastNudge: 0, lastSessionEnd: {} };
  return { study, rt };
}
async function append(key, item) {
  const s = await chrome.storage.local.get([key]);
  const arr = s[key] || [];
  arr.push(item);
  await chrome.storage.local.set({ [key]: arr });
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function score(model, f) {
  if (model) {
    let z = model.intercept;
    model.features.forEach((name, i) => { z += model.coef[i] * ((f[name] - model.mean[i]) / (model.std[i] || 1)); });
    return { p: sigmoid(z), threshold: model.threshold };
  }
  const p = Math.min(1, f.elapsed_min / 20) * (f.clicks_pm < 2 ? 1 : 0.5);
  return { p, threshold: 0.75 };
}

function features(sess, recent, t, sinceLast) {
  const dur = recent.reduce((a, r) => a + r.dur_s, 0) || 1;
  const px = recent.reduce((a, r) => a + r.px, 0);
  const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  return {
    elapsed_min: (t - sess.start) / 60000,
    speed_2m: px / dur,
    clicks_pm: recent.reduce((a, r) => a + r.clicks, 0) * 60 / dur,
    reversals_pm: recent.reduce((a, r) => a + r.reversals, 0) * 60 / dur,
    pause_frac: recent.filter(r => r.px === 0).length / recent.length,
    hour_sin: Math.sin(2 * Math.PI * h / 24),
    hour_cos: Math.cos(2 * Math.PI * h / 24),
    since_last_min: Math.min(sinceLast, 240)
  };
}

async function onWindow(m) {
  const t = m.t_end;
  const { study, rt } = await load();
  const { day, cond } = condition(study, t);
  const active = m.visible || m.wheel_px > 0 || m.page_px > 0 || m.clicks > 0 || m.keys > 0;
  if (!active) return { action: 'none' };
  const date = localDate(t);
  let sess = rt.sessions[m.site];
  if (!sess || t - sess.last > WINDOW_GAP_MS) {
    const prevEnd = rt.lastSessionEnd[m.site];
    sess = { id: crypto.randomUUID(), start: t - m.dur_ms, last: t, sinceLast: prevEnd ? (t - m.dur_ms - prevEnd) / 60000 : 240 };
    rt.sessions[m.site] = sess;
    rt.recent[m.site] = [];
    await append('e_' + date, { t, date, day, condition: cond, type: 'session_start', site: m.site, session_id: sess.id, value: '' });
  }
  sess.last = t;
  rt.lastSessionEnd[m.site] = t;
  const px = Math.max(m.wheel_px, m.page_px);
  const rec = { dur_s: m.dur_ms / 1000, px, clicks: m.clicks, reversals: m.reversals };
  rt.recent[m.site] = [...(rt.recent[m.site] || []), rec].slice(-RECENT);
  const f = features(sess, rt.recent[m.site], t, sess.sinceLast);
  const sc = score(study.model, f);
  const row = { t, date, day, condition: cond, site: m.site, session_id: sess.id, dur_s: rec.dur_s, px, wheel_px: m.wheel_px, page_px: m.page_px,
    scroll_events: m.scroll_events, reversals: m.reversals, clicks: m.clicks, keys: m.keys, visible: m.visible ? 1 : 0, ...f, score: sc.p };
  await append('w_' + date, row);

  let action = 'none';
  const base = { t, date, day, condition: cond, site: m.site, session_id: sess.id, score: sc.p, elapsed_min: f.elapsed_min };
  if (!m.busy && m.visible && f.elapsed_min >= MIN_NUDGE_MIN && t - rt.lastNudge >= NUDGE_COOLDOWN_MS && sc.p >= sc.threshold) {
    rt.lastNudge = t;
    if (cond === 'nudge') {
      action = 'nudge';
      await append('e_' + date, { ...base, type: 'nudge', value: '' });
    } else {
      await append('e_' + date, { ...base, type: 'shadow_nudge', value: '' });
    }
  }
  if (action === 'none' && !m.busy && m.visible && f.elapsed_min >= 2 && t - rt.lastPrompt >= rt.nextPromptGap) {
    rt.lastPrompt = t;
    const lo = cond === 'baseline' ? 8 : 20, hi = cond === 'baseline' ? 16 : 30;
    rt.nextPromptGap = (lo + Math.random() * (hi - lo)) * 60000;
    action = 'prompt';
    await append('e_' + date, { ...base, type: 'prompt_shown', value: '' });
  }
  await chrome.storage.local.set({ rt });
  return { action, minutes: Math.round(f.elapsed_min), site: m.site, token: t };
}

async function onEvent(m) {
  const { study } = await load();
  const t = Date.now();
  const { day, cond } = condition(study, t);
  const s = await chrome.storage.local.get(['rt']);
  const sess = s.rt && s.rt.sessions[m.site];
  await append('e_' + localDate(t), { t, date: localDate(t), day, condition: cond, type: m.kind, site: m.site,
    session_id: sess ? sess.id : '', value: String(m.value), token: m.token });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const job = m.type === 'window' ? () => onWindow(m) : m.type === 'event' ? () => onEvent(m) : null;
  if (!job) return false;
  serial(job).then(reply, e => reply({ action: 'none', error: String(e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => serial(load));
