/**
 * Global 김덕진 — English Subtitles & AI Summary for Korean YouTube broadcasts.
 *
 * Runs on youtube.com/watch pages. Pulls the video's Korean caption track,
 * translates it to English (Google free endpoint / Claude API / OpenAI API),
 * overlays the English subtitles on the player, and shows an English AI
 * summary panel (curated for the Kim Dukjin playlist, live-generated otherwise).
 */

(() => {
  'use strict';

  const STATE = {
    videoId: null,
    cues: [],            // [{start, end, ko, en}]
    cueIndex: -1,
    overlayEl: null,
    panelEl: null,
    toggleEl: null,
    enabled: true,
    dual: false,         // show Korean + English together
    translating: false,
    abort: null,         // generation token to cancel stale work
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        { enabled: true, dual: false, autoSummary: true },
        resolve
      );
    });
  }

  function msg(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(res || { error: 'no response' });
        });
      } catch (e) {
        resolve({ error: String(e) });
      }
    });
  }

  // ---------------------------------------------------------------- captions

  async function fetchCaptionTracks(videoId) {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: 'same-origin',
    });
    const html = await res.text();
    const key = '"captionTracks":';
    const at = html.indexOf(key);
    if (at === -1) return [];
    // bracket-count the array — track objects contain nested arrays, so a
    // non-greedy regex would truncate the JSON
    const start = html.indexOf('[', at);
    if (start === -1) return [];
    let depth = 0, inStr = false, escaped = false, end = -1;
    for (let i = start; i < html.length && i < start + 200000; i++) {
      const ch = html[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']' && --depth === 0) { end = i; break; }
    }
    if (end === -1) return [];
    try {
      return JSON.parse(html.slice(start, end + 1).replace(/\\u0026/g, '&'));
    } catch {
      return [];
    }
  }

  function pickKoreanTrack(tracks) {
    if (!tracks.length) return null;
    // prefer human-made Korean captions over auto-generated (asr)
    return (
      tracks.find((t) => t.languageCode?.startsWith('ko') && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode?.startsWith('ko')) ||
      null
    );
  }

  async function fetchCues(track) {
    const url = track.baseUrl + (track.baseUrl.includes('fmt=') ? '' : '&fmt=json3');
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`caption fetch ${res.status}`);
    const data = await res.json();
    const cues = [];
    for (const ev of data.events || []) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      const start = (ev.tStartMs || 0) / 1000;
      const dur = (ev.dDurationMs || 4000) / 1000;
      cues.push({ start, end: start + dur, ko: text, en: null });
    }
    // merge cues so overlapping auto-captions don't flicker
    for (let i = 0; i < cues.length - 1; i++) {
      if (cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
    }
    return cues;
  }

  // ------------------------------------------------------------- translation

  async function translateAll(token) {
    const BATCH = 40;
    STATE.translating = true;
    updatePanelStatus();
    for (let i = 0; i < STATE.cues.length; i += BATCH) {
      if (token.cancelled) break;
      const batch = STATE.cues.slice(i, i + BATCH);
      const res = await msg({
        type: 'translate',
        videoId: STATE.videoId,
        batchIndex: i,
        lines: batch.map((c) => c.ko),
      });
      if (token.cancelled) break;
      if (res.error) {
        console.warn('[Global KDJ] translate error:', res.error);
        setPanelNotice(`Translation error: ${res.error}`);
        break;
      }
      res.translations.forEach((t, j) => {
        if (STATE.cues[i + j]) STATE.cues[i + j].en = t || null;
      });
      renderCue(true);
      updatePanelStatus(Math.min(i + BATCH, STATE.cues.length));
    }
    if (token.cancelled) return; // a newer video owns the panel now
    STATE.translating = false;
    updatePanelStatus();
  }

  // ------------------------------------------------------------------ overlay

  function ensureOverlay() {
    const player = $('#movie_player');
    if (!player) return null;
    if (STATE.overlayEl && player.contains(STATE.overlayEl)) return STATE.overlayEl;
    const el = document.createElement('div');
    el.id = 'gkdj-subtitle-overlay';
    player.appendChild(el);
    STATE.overlayEl = el;
    return el;
  }

  function renderCue(force) {
    const overlay = ensureOverlay();
    const video = $('video.html5-main-video');
    if (!overlay || !video) return;
    if (!STATE.enabled || !STATE.cues.length) {
      overlay.style.display = 'none';
      return;
    }
    const t = video.currentTime;
    let idx = STATE.cueIndex;
    if (idx < 0 || idx >= STATE.cues.length || t < STATE.cues[idx].start || t >= STATE.cues[idx].end) {
      idx = STATE.cues.findIndex((c) => t >= c.start && t < c.end);
    }
    if (idx === STATE.cueIndex && !force) return;
    STATE.cueIndex = idx;
    if (idx === -1) {
      overlay.style.display = 'none';
      return;
    }
    const cue = STATE.cues[idx];
    const en = cue.en || '<span class="gkdj-pending">translating…</span>';
    overlay.innerHTML = STATE.dual
      ? `<div class="gkdj-line gkdj-ko">${escapeHtml(cue.ko)}</div><div class="gkdj-line gkdj-en">${cue.en ? escapeHtml(cue.en) : en}</div>`
      : `<div class="gkdj-line gkdj-en">${cue.en ? escapeHtml(cue.en) : en}</div>`;
    overlay.style.display = 'block';
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ------------------------------------------------------------------- panel

  function ensurePanel() {
    if (STATE.panelEl && document.body.contains(STATE.panelEl)) return STATE.panelEl;
    const host = $('#secondary #related') ? $('#secondary') : document.body;
    const el = document.createElement('div');
    el.id = 'gkdj-panel';
    if (host === document.body) el.classList.add('gkdj-floating');
    el.innerHTML = `
      <div class="gkdj-panel-head">
        <span class="gkdj-logo">🌏 Global 김덕진</span>
        <span class="gkdj-status" id="gkdj-status"></span>
        <button id="gkdj-close" title="Hide panel">×</button>
      </div>
      <div class="gkdj-panel-body" id="gkdj-body">
        <div class="gkdj-notice">Loading…</div>
      </div>
      <div class="gkdj-panel-foot">
        <label><input type="checkbox" id="gkdj-sub-toggle"> English subtitles</label>
        <label><input type="checkbox" id="gkdj-dual-toggle"> KO + EN</label>
      </div>`;
    host.prepend(el);
    STATE.panelEl = el;
    $('#gkdj-close', el).addEventListener('click', () => (el.style.display = 'none'));
    const sub = $('#gkdj-sub-toggle', el);
    sub.checked = STATE.enabled;
    sub.addEventListener('change', () => {
      STATE.enabled = sub.checked;
      chrome.storage.sync.set({ enabled: STATE.enabled });
      renderCue(true);
    });
    const dual = $('#gkdj-dual-toggle', el);
    dual.checked = STATE.dual;
    dual.addEventListener('change', () => {
      STATE.dual = dual.checked;
      chrome.storage.sync.set({ dual: STATE.dual });
      renderCue(true);
    });
    return el;
  }

  function setPanelBody(html) {
    const el = ensurePanel();
    $('#gkdj-body', el).innerHTML = html;
  }

  function setPanelNotice(text) {
    setPanelBody(`<div class="gkdj-notice">${escapeHtml(text)}</div>`);
  }

  function updatePanelStatus(done) {
    const el = STATE.panelEl && $('#gkdj-status', STATE.panelEl);
    if (!el) return;
    if (STATE.translating && done != null) {
      el.textContent = `translating ${done}/${STATE.cues.length}`;
    } else if (STATE.translating) {
      el.textContent = 'translating…';
    } else {
      el.textContent = STATE.cues.length ? `${STATE.cues.length} lines` : '';
    }
  }

  function renderSummary(summary) {
    if (!summary) return;
    const points = (summary.key_points || [])
      .map((p) => `<li>${escapeHtml(p)}</li>`)
      .join('');
    setPanelBody(`
      ${summary.title_en ? `<div class="gkdj-title">${escapeHtml(summary.title_en)}</div>` : ''}
      ${summary.date ? `<div class="gkdj-date">Broadcast: ${escapeHtml(summary.date)}${summary.curated ? ' · curated' : ' · AI-generated'}</div>` : ''}
      <p class="gkdj-summary">${escapeHtml(summary.summary_en || '')}</p>
      ${points ? `<div class="gkdj-subhead">Key takeaways</div><ul class="gkdj-points">${points}</ul>` : ''}
    `);
  }

  // ----------------------------------------------------------------- summary

  async function loadSummary(token) {
    const bundled = await msg({ type: 'getBundledSummary', videoId: STATE.videoId });
    if (token.cancelled) return;
    if (bundled && bundled.summary) {
      renderSummary({ ...bundled.summary, curated: true });
      return;
    }
    const settings = await getSettings();
    if (token.cancelled) return;
    if (!settings.autoSummary) {
      setPanelNotice('English subtitles active. AI summary is off (enable in extension popup).');
      return;
    }
    if (!STATE.cues.length) return;
    setPanelBody('<div class="gkdj-notice">Generating English summary…</div>');
    const transcript = STATE.cues.map((c) => c.ko).join(' ').slice(0, 14000);
    const title = document.title.replace(/ - YouTube$/, '');
    const res = await msg({ type: 'summarize', videoId: STATE.videoId, title, transcript });
    if (token.cancelled) return;
    if (res.error) {
      setPanelNotice(
        res.error === 'NO_API_KEY'
          ? 'Live AI summary needs a Claude or OpenAI API key — set one in the extension popup. (Subtitles still work without a key.)'
          : `Summary error: ${res.error}`
      );
      return;
    }
    renderSummary(res.summary);
  }

  // ------------------------------------------------------------------- main

  async function initForVideo(videoId) {
    if (STATE.abort) STATE.abort.cancelled = true;
    const token = { cancelled: false };
    STATE.abort = token;
    STATE.videoId = videoId;
    STATE.cues = [];
    STATE.cueIndex = -1;

    const settings = await getSettings();
    STATE.enabled = settings.enabled;
    STATE.dual = settings.dual;

    ensurePanel();
    setPanelNotice('Looking for Korean captions…');

    try {
      // cached full translation?
      const cached = await msg({ type: 'getCache', videoId });
      if (!token.cancelled && cached && cached.cues) {
        STATE.cues = cached.cues;
        updatePanelStatus();
        renderCue(true);
        loadSummary(token);
        return;
      }

      const tracks = await fetchCaptionTracks(videoId);
      if (token.cancelled) return;
      const track = pickKoreanTrack(tracks);
      if (!track) {
        setPanelNotice('No Korean caption track found on this video.');
        return;
      }
      STATE.cues = await fetchCues(track);
      if (token.cancelled) return;
      updatePanelStatus();
      loadSummary(token);
      await translateAll(token);
      if (!token.cancelled && STATE.cues.length && STATE.cues.every((c) => c.en)) {
        msg({ type: 'setCache', videoId, cues: STATE.cues });
      }
    } catch (e) {
      console.warn('[Global KDJ]', e);
      setPanelNotice(`Could not load captions: ${e.message || e}`);
    }
  }

  function currentVideoId() {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v');
    } catch {}
    return null;
  }

  let lastId = null;
  function checkNavigation() {
    // if the panel was created floating before #secondary rendered, re-host it
    if (STATE.panelEl && STATE.panelEl.classList.contains('gkdj-floating')) {
      const sec = $('#secondary');
      if (sec && $('#related', sec)) {
        STATE.panelEl.classList.remove('gkdj-floating');
        sec.prepend(STATE.panelEl);
      }
    }
    const id = currentVideoId();
    if (id && id !== lastId) {
      lastId = id;
      initForVideo(id);
    } else if (!id && lastId) {
      lastId = null;
      if (STATE.abort) STATE.abort.cancelled = true;
      if (STATE.overlayEl) STATE.overlayEl.style.display = 'none';
      if (STATE.panelEl) STATE.panelEl.remove();
      STATE.panelEl = null;
    }
  }

  // subtitle sync loop
  function tick() {
    if (currentVideoId()) renderCue(false);
    requestAnimationFrame(tick);
  }

  // react to popup setting changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enabled) {
      STATE.enabled = changes.enabled.newValue;
      renderCue(true);
      if (STATE.panelEl) $('#gkdj-sub-toggle', STATE.panelEl).checked = STATE.enabled;
    }
    if (changes.dual) {
      STATE.dual = changes.dual.newValue;
      renderCue(true);
      if (STATE.panelEl) $('#gkdj-dual-toggle', STATE.panelEl).checked = STATE.dual;
    }
    if (changes.engine || changes.claudeKey || changes.openaiKey) {
      // Retranslate only when the *active* engine actually changed —
      // and debounce, because typing a key fires one change per keystroke.
      clearTimeout(STATE.retransTimer);
      STATE.retransTimer = setTimeout(async () => {
        if (!STATE.videoId) return;
        const s = await new Promise((r) => chrome.storage.sync.get({ engine: 'google' }, r));
        const keyChangedForActive =
          (s.engine === 'claude' && changes.claudeKey) ||
          (s.engine === 'openai' && changes.openaiKey);
        if (changes.engine || keyChangedForActive) {
          await msg({ type: 'clearCache', videoId: STATE.videoId });
          lastId = null;
          checkNavigation();
        }
      }, 2500);
    }
  });

  window.addEventListener('yt-navigate-finish', checkNavigation);
  setInterval(checkNavigation, 1500);
  checkNavigation();
  requestAnimationFrame(tick);
})();
