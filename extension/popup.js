const $ = id => document.getElementById(id);
const PHASE = { baseline: 'Baseline (no nudges)', nudge: 'Nudge day', control: 'No-nudge day', after: 'Study finished' };

function localDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function csv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

async function render() {
  const all = await chrome.storage.local.get(null);
  const study = all.study;
  if (!study) { $('start').textContent = 'not yet'; return; }
  const today = localDate(Date.now());
  const day = Math.round((new Date(today + 'T12:00:00') - new Date(study.startDate + 'T12:00:00')) / 86400000);
  const cond = day >= 0 && day < study.schedule.length ? study.schedule[day] : 'after';
  const w = all['w_' + today] || [], e = all['e_' + today] || [];
  $('start').textContent = study.startDate;
  $('day').textContent = `${Math.min(day + 1, study.schedule.length)} of ${study.schedule.length}`;
  $('phase').textContent = PHASE[cond];
  $('mins').textContent = Math.round(w.reduce((a, r) => a + r.dur_s, 0) / 60);
  $('answers').textContent = e.filter(x => x.type === 'prompt_answer').length;
  $('nudges').textContent = e.filter(x => x.type === 'nudge').length;
  $('model').textContent = study.model ? 'trained model' : 'starter rule';
}

$('export').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).sort();
  const w = keys.filter(k => k.startsWith('w_')).flatMap(k => all[k]);
  const e = keys.filter(k => k.startsWith('e_')).flatMap(k => all[k]);
  const stamp = localDate(Date.now());
  download(`scrollnudge_windows_${stamp}.csv`, csv(w));
  download(`scrollnudge_events_${stamp}.csv`, csv(e));
  download(`scrollnudge_study_${stamp}.csv`, csv(all.study.schedule.map((c, i) => ({ day: i, date_offset: i, condition: c, start_date: all.study.startDate }))));
  $('msg').textContent = `Exported ${w.length} windows and ${e.length} events.`;
});

$('file').addEventListener('change', async ev => {
  try {
    const m = JSON.parse(await ev.target.files[0].text());
    if (!Array.isArray(m.features) || m.features.length !== m.coef.length) throw new Error('bad file');
    const { study } = await chrome.storage.local.get(['study']);
    study.model = m;
    await chrome.storage.local.set({ study });
    $('msg').textContent = 'Detector loaded.';
    render();
  } catch (e) { $('msg').textContent = 'Could not read that file.'; }
});

let armed = false;
$('reset').addEventListener('click', async () => {
  if (!armed) { armed = true; $('reset').textContent = 'Click again to delete all data'; return; }
  await chrome.storage.local.clear();
  armed = false;
  $('reset').textContent = 'Restart study';
  $('msg').textContent = 'All data deleted. A new study starts on your next visit.';
  render();
});

render();
