const API = '/api';

const views = {
  home: document.getElementById('view-home'),
  characterSelect: document.getElementById('view-character-select'),
  story: document.getElementById('view-story'),
  worldEdit: document.getElementById('view-world-edit'),
  settings: document.getElementById('view-settings')
};

const SKILL_LABELS = { 1: 'Untrained', 2: 'Unskilled', 3: 'Competent', 4: 'Highly skilled', 5: 'Exceptional' };
const OUTCOME_LABELS = { success: '✅ Réussite', partial_success: '⚠️ Réussite partielle', failure: '❌ Échec' };

function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

let currentWorldId = null;
let lastImageUrl = null;

// ---------- Home ----------

async function loadWorldList() {
  const worlds = await fetch(`${API}/worlds`).then(r => r.json());
  const list = document.getElementById('worldList');
  list.innerHTML = '';
  worlds.slice().reverse().forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'world-card';
    const cover = w.coverImageUrl ? `<img class="world-card-cover" src="${w.coverImageUrl}" alt="">` : '';
    const desc = w.description ? `<span class="world-card-desc">${escapeHtml(w.description)}</span>` : '';
    btn.innerHTML = `${cover}<span class="world-card-body"><span class="world-card-title">${escapeHtml(w.title)}</span>${desc}<small>${escapeHtml(w.tone || '')}</small></span>`;
    btn.onclick = () => openWorld(w.id);
    list.appendChild(btn);
  });
}

document.getElementById('createWorldBtn').onclick = async () => {
  const idea = document.getElementById('ideaInput').value.trim();
  if (!idea) return;
  const btn = document.getElementById('createWorldBtn');
  btn.disabled = true;
  btn.textContent = 'Création du monde...';
  try {
    const res = await fetch(`${API}/worlds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
    document.getElementById('ideaInput').value = '';
    showCharacterSelect(data.world, data.playableCharacters || []);
  } catch (e) {
    alert('Impossible de créer le monde : ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Commencer';
  }
};

// ---------- Character selection ----------

function showCharacterSelect(world, playableCharacters) {
  currentWorldId = world.id;
  showView('characterSelect');
  document.getElementById('charSelectTitle').textContent = `Choisis ton personnage — ${world.title}`;
  const warningEl = document.getElementById('matureWarning');
  if (world.mature) {
    const warnings = (world.contentWarnings || []).join(', ');
    warningEl.textContent = `⚠️ Contenu mature${warnings ? ' : ' + warnings : ''}`;
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }
  const list = document.getElementById('characterList');
  list.innerHTML = '';
  playableCharacters.forEach(c => {
    const card = document.createElement('div');
    card.className = 'character-card';
    const skillsHtml = Object.entries(c.skills || {})
      .map(([skill, value]) => `<li>${escapeHtml(skill)}: ${value} <span class="skill-label">(${SKILL_LABELS[value] || 'Non noté'})</span></li>`)
      .join('');
    card.innerHTML = `
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.description)}</p>
      <ul class="skill-list">${skillsHtml}</ul>
      <button class="primary-btn choose-character-btn">Choisir ${escapeHtml(c.name)}</button>
    `;
    card.querySelector('.choose-character-btn').onclick = () => chooseCharacter(world.id, c.id);
    list.appendChild(card);
  });
}

async function chooseCharacter(worldId, characterId) {
  const res = await fetch(`${API}/worlds/${worldId}/select-character`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ characterId })
  });
  const data = await res.json();
  if (!res.ok) return alert('Impossible de choisir ce personnage : ' + data.error);
  await openWorld(worldId);
}

document.getElementById('backFromCharSelectBtn').onclick = () => {
  currentWorldId = null;
  showView('home');
  loadWorldList();
};

// ---------- Story ----------

async function openWorld(id) {
  currentWorldId = id;
  const data = await fetch(`${API}/worlds/${id}`).then(r => r.json());
  if (!data.world.activeCharacterId) {
    showCharacterSelect(data.world, data.playableCharacters || []);
    return;
  }
  showView('story');
  const feed = document.getElementById('chapterFeed');
  feed.innerHTML = '<p class="loading">Chargement de l\'histoire...</p>';
  document.getElementById('storyTitle').textContent = data.world.title;
  const activeCharacter = (data.playableCharacters || []).find(c => c.id === data.world.activeCharacterId);
  const charEl = document.getElementById('storyCharacter');
  if (activeCharacter) {
    charEl.textContent = `Tu joues ${activeCharacter.name}`;
    charEl.classList.remove('hidden');
  } else {
    charEl.classList.add('hidden');
  }
  const objectiveEl = document.getElementById('storyObjective');
  if (data.world.objective) {
    objectiveEl.textContent = `🎯 ${data.world.objective}`;
    objectiveEl.classList.remove('hidden');
  } else {
    objectiveEl.classList.add('hidden');
  }
  renderChapters(data.turns);
  renderGameOver(data.world.gameOver);
  renderTrackedItems(data.trackedItems || []);
}

function renderTrackedItems(items) {
  const panel = document.getElementById('trackedItemsPanel');
  if (!items.length) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  panel.innerHTML = items
    .map(i => `<div class="tracked-item"><span class="tracked-item-name">${escapeHtml(i.name)}</span><span class="tracked-item-value">${escapeHtml(String(i.value))}</span></div>`)
    .join('');
}

function renderGameOver(gameOver) {
  const banner = document.getElementById('gameOverBanner');
  const actions = document.getElementById('suggestedActions');
  const form = document.getElementById('actionForm');
  if (!gameOver) {
    banner.classList.add('hidden');
    banner.textContent = '';
    form.classList.remove('hidden');
    return;
  }
  const label = gameOver.result === 'victory' ? 'Victoire' : 'Fin de l\'histoire';
  const continueHtml = gameOver.result === 'victory'
    ? '<button id="continuePlayingBtn" class="primary-btn">Continuer à jouer</button>'
    : '';
  banner.className = `game-over-banner game-over-${gameOver.result}`;
  banner.innerHTML = `<strong>${label}</strong><p>${escapeHtml(gameOver.text)}</p>${continueHtml}`;
  if (gameOver.result === 'victory') {
    document.getElementById('continuePlayingBtn').onclick = continuePlaying;
  }
  actions.innerHTML = '';
  form.classList.add('hidden');
}

async function continuePlaying() {
  const res = await fetch(`${API}/worlds/${currentWorldId}/continue`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert('Impossible de continuer : ' + data.error);
  renderGameOver(null);
  const worldData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
  renderSuggestions(worldData.turns[worldData.turns.length - 1]?.suggestedActions || []);
}

function renderChapters(turns) {
  const feed = document.getElementById('chapterFeed');
  feed.innerHTML = '';
  turns.forEach(t => {
    const div = document.createElement('div');
    div.className = 'chapter';
    const outcomeLabel = OUTCOME_LABELS[t.outcome];
    const outcomeHtml = outcomeLabel ? ` <span class="outcome-badge outcome-${t.outcome}">${outcomeLabel}</span>` : '';
    const actionLine = t.turnNumber === 0 ? '' : `<div class="player-action">→ ${escapeHtml(t.playerAction)}${outcomeHtml}</div>`;
    div.innerHTML = `${actionLine}<div>${escapeHtml(t.chapterText)}</div>`;
    feed.appendChild(div);
    if (t.imageUrl) lastImageUrl = t.imageUrl;
  });
  feed.scrollIntoView({ block: 'end' });
  updateImage(turns[turns.length - 1]);
  renderSuggestions(turns[turns.length - 1]?.suggestedActions || []);
}

function updateImage(lastTurn) {
  const wrap = document.getElementById('storyImage');
  const img = document.getElementById('storyImageEl');
  if (lastTurn && lastTurn.imageUrl) {
    lastImageUrl = lastTurn.imageUrl;
  }
  if (lastImageUrl) {
    img.src = lastImageUrl;
    wrap.classList.remove('hidden');
  } else {
    wrap.classList.add('hidden');
  }
}

function renderSuggestions(actions) {
  const wrap = document.getElementById('suggestedActions');
  wrap.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = a;
    btn.onclick = () => playAction(a);
    wrap.appendChild(btn);
  });
}

async function playAction(action) {
  const input = document.getElementById('actionInput');
  input.value = '';
  const feed = document.getElementById('chapterFeed');
  const pending = document.createElement('p');
  pending.className = 'loading';
  pending.textContent = 'Le narrateur réfléchit...';
  feed.appendChild(pending);
  pending.scrollIntoView({ block: 'end' });
  document.getElementById('suggestedActions').innerHTML = '';

  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const turn = await res.json();
    if (!res.ok) throw new Error(turn.error || 'Erreur inconnue');
    pending.remove();
    const data = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
    renderChapters(data.turns);
    renderGameOver(data.world.gameOver);
    renderTrackedItems(data.trackedItems || []);
  } catch (e) {
    pending.textContent = 'Erreur : ' + e.message;
  }
}

document.getElementById('actionForm').onsubmit = (e) => {
  e.preventDefault();
  const val = document.getElementById('actionInput').value.trim();
  if (val) playAction(val);
};

document.getElementById('backBtn').onclick = () => {
  currentWorldId = null;
  lastImageUrl = null;
  showView('home');
  loadWorldList();
};

// ---------- World edit ----------

document.getElementById('editWorldBtn').onclick = async () => {
  const data = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
  document.getElementById('worldDescriptionInput').value = data.world.description || '';
  document.getElementById('worldObjectiveInput').value = data.world.objective || '';
  document.getElementById('worldMatureInput').checked = Boolean(data.world.mature);
  document.getElementById('worldContentWarningsInput').value = (data.world.contentWarnings || []).join(', ');
  document.getElementById('worldInstructionsInput').value = data.world.instructions || '';
  document.getElementById('worldAuthorStyleInput').value = data.world.authorStyle || '';
  document.getElementById('worldImageStyleInput').value = data.world.imageStyle || '';
  document.getElementById('worldImageStylePrefixInput').value = data.world.imageStylePrefix || '';
  document.getElementById('worldImageStyleSuffixInput').value = data.world.imageStyleSuffix || '';
  showView('worldEdit');
};

document.getElementById('closeWorldEditBtn').onclick = () => showView('story');

document.getElementById('saveWorldEditBtn').onclick = async () => {
  const body = {
    description: document.getElementById('worldDescriptionInput').value,
    objective: document.getElementById('worldObjectiveInput').value || null,
    mature: document.getElementById('worldMatureInput').checked,
    contentWarnings: document.getElementById('worldContentWarningsInput').value.split(',').map(s => s.trim()).filter(Boolean),
    instructions: document.getElementById('worldInstructionsInput').value,
    authorStyle: document.getElementById('worldAuthorStyleInput').value,
    imageStyle: document.getElementById('worldImageStyleInput').value,
    imageStylePrefix: document.getElementById('worldImageStylePrefixInput').value,
    imageStyleSuffix: document.getElementById('worldImageStyleSuffixInput').value
  };
  const res = await fetch(`${API}/worlds/${currentWorldId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const status = document.getElementById('worldEditStatus');
  if (!res.ok) {
    status.textContent = 'Erreur : ' + data.error;
    return;
  }
  status.textContent = 'Enregistré.';
  setTimeout(() => { status.textContent = ''; }, 2000);
};

// ---------- Settings ----------

document.getElementById('settingsBtn').onclick = async () => {
  await loadSettings();
  showView('settings');
};
document.getElementById('closeSettingsBtn').onclick = () => {
  showView(currentWorldId ? 'story' : 'home');
};

async function loadSettings() {
  const s = await fetch(`${API}/settings`).then(r => r.json());
  document.getElementById('textProvider').value = s.textProvider;
  document.getElementById('textModel').value = s.textModel || '';
  document.getElementById('imageProvider').value = s.imageProvider;
  document.getElementById('imagesEnabled').checked = s.imagesEnabled;
  ['anthropic', 'openai', 'openrouter', 'gemini', 'stability', 'replicate'].forEach(p => {
    const field = document.getElementById(`key-${p}`);
    field.placeholder = s.apiKeys[p] ? '•••••••• (déjà enregistrée)' : field.placeholder;
  });
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  const apiKeys = {};
  ['anthropic', 'openai', 'openrouter', 'gemini', 'stability', 'replicate'].forEach(p => {
    const val = document.getElementById(`key-${p}`).value.trim();
    if (val) apiKeys[p] = val; // only overwrite if the user typed something new
  });
  const body = {
    textProvider: document.getElementById('textProvider').value,
    textModel: document.getElementById('textModel').value.trim(),
    imageProvider: document.getElementById('imageProvider').value,
    imagesEnabled: document.getElementById('imagesEnabled').checked,
    apiKeys
  };
  await fetch(`${API}/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.getElementById('settingsStatus').textContent = 'Enregistré.';
  ['anthropic', 'openai', 'openrouter', 'gemini', 'stability', 'replicate'].forEach(p => {
    document.getElementById(`key-${p}`).value = '';
  });
  await loadSettings();
  setTimeout(() => { document.getElementById('settingsStatus').textContent = ''; }, 2000);
};

// ---------- Utils ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- Init ----------

loadWorldList();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
