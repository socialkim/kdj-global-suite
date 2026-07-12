/**
 * Global 김덕진 — background service worker.
 * Handles translation (Google free / Claude API / OpenAI API), AI summaries,
 * per-video caching, and serving the bundled curated summaries.
 */

'use strict';

const DEFAULTS = {
  engine: 'google',              // 'google' | 'claude' | 'openai'
  claudeKey: '',
  openaiKey: '',
  claudeModel: 'claude-opus-4-8',
  openaiModel: 'gpt-4o-mini',
  autoSummary: true,
};

function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULTS, resolve));
}

// ------------------------------------------------------- bundled summaries

let bundledSummaries = null;
async function getBundled() {
  if (bundledSummaries) return bundledSummaries;
  try {
    const res = await fetch(chrome.runtime.getURL('data/summaries.json'));
    bundledSummaries = await res.json();
    return bundledSummaries;
  } catch {
    return {}; // don't cache the failure — retry on next call
  }
}

// ------------------------------------------------------------------ engines

async function translateGoogle(lines) {
  // Free endpoint; accepts multiple q params and returns aligned translations.
  const body = new URLSearchParams();
  body.append('client', 'gtx');
  body.append('sl', 'ko');
  body.append('tl', 'en');
  body.append('format', 'text');
  for (const line of lines) body.append('q', line);
  const res = await fetch('https://translate.googleapis.com/translate_a/t?client=gtx&sl=ko&tl=en&format=text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Google translate HTTP ${res.status}`);
  const data = await res.json();
  // Shapes seen in the wild: ["hi", ...] or [["hi","ko"], ...] or "hi" (single q)
  const arr = Array.isArray(data) ? data : [data];
  const out = arr.map((item) => (Array.isArray(item) ? item[0] : item));
  if (out.length !== lines.length) {
    // fall back to line-by-line so alignment is never wrong
    return Promise.all(lines.map(translateGoogleSingle));
  }
  return out;
}

async function translateGoogleSingle(line) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=' +
    encodeURIComponent(line);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google translate HTTP ${res.status}`);
  const data = await res.json();
  return (data[0] || []).map((seg) => seg[0]).join('');
}

const TRANSLATE_SYSTEM = `You translate Korean tech-broadcast subtitles into natural English.
The speaker is Kim Dukjin, a Korean AI/tech commentator. Keep his conversational,
storytelling tone. Keep company names, model names, and numbers exact.
Translate line by line — output exactly one English line per input line, same order.`;

async function translateClaude(lines, settings) {
  const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
  const body = {
    model: settings.claudeModel || 'claude-opus-4-8',
    max_tokens: 8000,
    system: TRANSLATE_SYSTEM,
    messages: [{ role: 'user', content: `Translate these ${lines.length} subtitle lines:\n${numbered}` }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            translations: { type: 'array', items: { type: 'string' } },
          },
          required: ['translations'],
          additionalProperties: false,
        },
      },
    },
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const text = (data.content || []).find((b) => b.type === 'text')?.text || '{}';
  const parsed = JSON.parse(text);
  const out = parsed.translations || [];
  while (out.length < lines.length) out.push(null);
  return out.slice(0, lines.length);
}

async function translateOpenAI(lines, settings) {
  const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM + '\nRespond with JSON: {"translations": ["...", ...]}' },
        { role: 'user', content: `Translate these ${lines.length} subtitle lines:\n${numbered}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  const out = parsed.translations || [];
  while (out.length < lines.length) out.push(null);
  return out.slice(0, lines.length);
}

async function translate(lines) {
  const settings = await getSettings();
  if (settings.engine === 'claude' && settings.claudeKey) return translateClaude(lines, settings);
  if (settings.engine === 'openai' && settings.openaiKey) return translateOpenAI(lines, settings);
  return translateGoogle(lines);
}

// ------------------------------------------------------------------ summary

const SUMMARY_SYSTEM = `You summarize Korean tech broadcasts for a global English-speaking audience.
The speaker is Kim Dukjin (김덕진), director of the IT Communication Research Institute,
a well-known Korean AI commentator. Given a (possibly truncated) Korean transcript,
produce an English summary that stands alone for someone who cannot watch in Korean.`;

async function summarize(title, transcript) {
  const settings = await getSettings();
  const schema = {
    type: 'object',
    properties: {
      title_en: { type: 'string' },
      summary_en: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
    },
    required: ['title_en', 'summary_en', 'key_points'],
    additionalProperties: false,
  };
  const userPrompt = `Video title: ${title}\n\nKorean transcript (may be truncated):\n${transcript}\n\nReturn: title_en (natural English title), summary_en (120-180 words), key_points (4-6 bullets).`;

  // honor the selected engine first; fall back to whichever key exists
  const preferOpenAI = settings.engine === 'openai' && settings.openaiKey;
  if (settings.claudeKey && !preferOpenAI) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.claudeModel || 'claude-opus-4-8',
        max_tokens: 2000,
        system: SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema } },
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this request');
    const text = (data.content || []).find((b) => b.type === 'text')?.text || '{}';
    return JSON.parse(text);
  }
  if (settings.openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiKey}`,
      },
      body: JSON.stringify({
        model: settings.openaiModel || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM + '\nRespond with JSON: {"title_en", "summary_en", "key_points": []}' },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  }
  const err = new Error('NO_API_KEY');
  err.code = 'NO_API_KEY';
  throw err;
}

// -------------------------------------------------------------------- cache

const CACHE_LIMIT = 30;

async function cacheGet(videoId) {
  const key = `cache:${videoId}`;
  const obj = await chrome.storage.local.get(key);
  return obj[key] || null;
}

async function cacheSet(videoId, cues) {
  const key = `cache:${videoId}`;
  await chrome.storage.local.set({ [key]: { cues, ts: Date.now() } });
  // prune oldest beyond limit
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith('cache:'))
    .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  if (entries.length > CACHE_LIMIT) {
    const remove = entries.slice(0, entries.length - CACHE_LIMIT).map(([k]) => k);
    await chrome.storage.local.remove(remove);
  }
}

// ----------------------------------------------------------------- dispatch

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  (async () => {
    try {
      switch (req.type) {
        case 'translate': {
          const translations = await translate(req.lines);
          sendResponse({ translations });
          break;
        }
        case 'summarize': {
          const summary = await summarize(req.title, req.transcript);
          sendResponse({ summary });
          break;
        }
        case 'getBundledSummary': {
          const bundled = await getBundled();
          sendResponse({ summary: bundled[req.videoId] || null });
          break;
        }
        case 'getCache': {
          sendResponse((await cacheGet(req.videoId)) || {});
          break;
        }
        case 'setCache': {
          await cacheSet(req.videoId, req.cues);
          sendResponse({ ok: true });
          break;
        }
        case 'clearCache': {
          await chrome.storage.local.remove(`cache:${req.videoId}`);
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ error: `unknown message type ${req.type}` });
      }
    } catch (e) {
      sendResponse({ error: e.code || e.message || String(e) });
    }
  })();
  return true; // keep the message channel open for async response
});
