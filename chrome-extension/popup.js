'use strict';

const DEFAULTS = {
  enabled: true,
  dual: false,
  autoSummary: true,
  engine: 'google',
  claudeKey: '',
  openaiKey: '',
  claudeModel: 'claude-opus-4-8',
  openaiModel: 'gpt-4o-mini',
};

const $ = (id) => document.getElementById(id);
let saveTimer = null;

function refreshEngineBoxes() {
  const engine = $('engine').value;
  $('claudeBox').style.display = engine === 'claude' ? 'block' : 'none';
  $('openaiBox').style.display = engine === 'openai' ? 'block' : 'none';
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set(
      {
        enabled: $('enabled').checked,
        dual: $('dual').checked,
        autoSummary: $('autoSummary').checked,
        engine: $('engine').value,
        claudeKey: $('claudeKey').value.trim(),
        openaiKey: $('openaiKey').value.trim(),
        claudeModel: $('claudeModel').value.trim() || 'claude-opus-4-8',
        openaiModel: $('openaiModel').value.trim() || 'gpt-4o-mini',
      },
      () => {
        $('saved').textContent = 'Saved ✓';
        setTimeout(() => ($('saved').textContent = ''), 1200);
      }
    );
  }, 250);
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('enabled').checked = s.enabled;
  $('dual').checked = s.dual;
  $('autoSummary').checked = s.autoSummary;
  $('engine').value = s.engine;
  $('claudeKey').value = s.claudeKey;
  $('openaiKey').value = s.openaiKey;
  $('claudeModel').value = s.claudeModel;
  $('openaiModel').value = s.openaiModel;
  refreshEngineBoxes();
});

for (const id of ['enabled', 'dual', 'autoSummary', 'engine', 'claudeKey', 'openaiKey', 'claudeModel', 'openaiModel']) {
  $(id).addEventListener('change', () => { refreshEngineBoxes(); save(); });
  $(id).addEventListener('input', save);
}
