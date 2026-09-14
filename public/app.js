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
const CREATION_STEPS = [
  'Écriture du monde...',
  'Création des personnages...',
  'Réglage des compétences...',
  'Mise en place des objets suivis...',
  'Dernières touches...'
];

let currentSaveId = null;   // active save while in the story / character-select views
let currentWorldId = null;  // active world while in the world-editor view
let currentWorldSkills = []; // world.skills, needed to render character skill inputs
let lastImageUrl = null;
let previousView = 'home';

function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

// ---------- Home ----------

async function loadHome() {
  const [saves, worlds] = await Promise.all([
    fetch(`${API}/saves`).then(r => r.json()),
    fetch(`${API}/worlds`).then(r => r.json())
  ]);
  renderSaveList(saves);
  renderWorldList(worlds);
}

function renderSaveList(saves) {
  const heading = document.getElementById('saveListHeading');
  const list = document.getElementById('saveList');
  list.innerHTML = '';
  if (!saves.length) {
    heading.hidden = true;
    return;
  }
  heading.hidden = false;
  saves.slice().reverse().forEach(s => {
    const card = document.createElement('div');
    card.className = 'save-card';
    const cover = s.coverImageUrl ? `<img class="world-card-cover" src="${s.coverImageUrl}" alt="">` : '';
    const sub = s.gameOver
      ? (s.gameOver.result === 'victory' ? '🏆 Terminé (victoire)' : '💀 Terminé (défaite)')
      : (s.lastAction && s.lastAction !== '(story begins)' ? `→ ${escapeHtml(s.lastAction)}` : 'Pas encore commencé');
    card.innerHTML = `
      ${cover}
      <span class="world-card-body">
        <span class="world-card-title">${escapeHtml(s.worldTitle)}</span>
        <span class="world-card-desc">${sub}</span>
        <small>${s.turnCount} tour${s.turnCount > 1 ? 's' : ''}</small>
      </span>
      <button class="icon-btn danger-text save-delete-btn" title="Supprimer cette sauvegarde">🗑️</button>
    `;
    card.querySelector('.world-card-body').onclick = () => openSave(s.id);
    card.querySelector('.save-delete-btn').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Supprimer cette sauvegarde de "${s.worldTitle}" ? Cette action est irréversible.`)) return;
      await fetch(`${API}/saves/${s.id}`, { method: 'DELETE' });
      loadHome();
    };
    list.appendChild(card);
  });
}

function renderWorldList(worlds) {
  const list = document.getElementById('worldList');
  list.innerHTML = '';
  worlds.slice().reverse().forEach(w => {
    const card = document.createElement('div');
    card.className = 'world-card';
    const cover = w.coverImageUrl ? `<img class="world-card-cover" src="${w.coverImageUrl}" alt="">` : '';
    const desc = w.description ? `<span class="world-card-desc">${escapeHtml(w.description)}</span>` : '';
    card.innerHTML = `
      ${cover}
      <span class="world-card-body">
        <span class="world-card-title">${escapeHtml(w.title)}</span>
        ${desc}
        <small>${escapeHtml(w.tone || '')}${w.saveCount ? ` · ${w.saveCount} sauvegarde${w.saveCount > 1 ? 's' : ''}` : ''}</small>
      </span>
      <span class="world-card-actions">
        <button class="icon-btn" title="Nouvelle aventure">▶</button>
        <button class="icon-btn" title="Éditer">✏️</button>
        <button class="icon-btn danger-text" title="Supprimer">🗑️</button>
      </span>
    `;
    const [playBtn, editBtn, delBtn] = card.querySelectorAll('button');
    playBtn.onclick = () => startNewAdventure(w.id);
    editBtn.onclick = () => openWorldEditor(w.id);
    delBtn.onclick = async () => {
      if (!confirm(`Supprimer le monde "${w.title}" et toutes ses sauvegardes ? Cette action est irréversible.`)) return;
      await fetch(`${API}/worlds/${w.id}`, { method: 'DELETE' });
      loadHome();
    };
    list.appendChild(card);
  });
}

// ---------- Create world ----------

let creationInterval = null;

function startCreationProgress() {
  const wrap = document.getElementById('creationProgress');
  const text = document.getElementById('creationProgressText');
  wrap.classList.remove('hidden');
  let step = 0;
  text.textContent = CREATION_STEPS[0];
  creationInterval = setInterval(() => {
    step = (step + 1) % CREATION_STEPS.length;
    text.textContent = CREATION_STEPS[step];
  }, 1400);
}

function stopCreationProgress() {
  clearInterval(creationInterval);
  document.getElementById('creationProgress').classList.add('hidden');
}

document.getElementById('createWorldBtn').onclick = async () => {
  const idea = document.getElementById('ideaInput').value.trim();
  if (!idea) return;
  const btn = document.getElementById('createWorldBtn');
  btn.disabled = true;
  startCreationProgress();
  try {
    const res = await fetch(`${API}/worlds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
    document.getElementById('ideaInput').value = '';
    populateWorldEditor(data.world, data.playableCharacters);
    showView('worldEdit');
  } catch (e) {
    alert('Impossible de créer le monde : ' + e.message);
  } finally {
    btn.disabled = false;
    stopCreationProgress();
  }
};

// ---------- World editor ----------

async function openWorldEditor(worldId) {
  const data = await fetch(`${API}/worlds/${worldId}`).then(r => r.json());
  populateWorldEditor(data.world, data.playableCharacters);
  showView('worldEdit');
}

function populateWorldEditor(world, playableCharacters) {
  currentWorldId = world.id;
  currentWorldSkills = world.skills || [];
  document.getElementById('worldEditTitle').textContent = world.title;
  document.getElementById('worldDescriptionInput').value = world.description || '';
  document.getElementById('worldObjectiveInput').value = world.objective || '';
  document.getElementById('worldMatureInput').checked = Boolean(world.mature);
  document.getElementById('worldContentWarningsInput').value = (world.contentWarnings || []).join(', ');
  document.getElementById('worldInstructionsInput').value = world.instructions || '';
  document.getElementById('worldAuthorStyleInput').value = world.authorStyle || '';
  document.getElementById('worldImageStyleInput').value = world.imageStyle || '';
  document.getElementById('worldImageStylePrefixInput').value = world.imageStylePrefix || '';
  document.getElementById('worldImageStyleSuffixInput').value = world.imageStyleSuffix || '';
  document.getElementById('worldAiEditInput').value = '';
  document.getElementById('worldAiEditStatus').textContent = '';
  renderCharacterEditList(playableCharacters || []);
}

document.getElementById('closeWorldEditBtn').onclick = () => {
  showView(currentSaveId ? 'story' : 'home');
  if (!currentSaveId) loadHome();
};

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

document.getElementById('worldAiEditBtn').onclick = async () => {
  const instruction = document.getElementById('worldAiEditInput').value.trim();
  if (!instruction) return;
  const btn = document.getElementById('worldAiEditBtn');
  const status = document.getElementById('worldAiEditStatus');
  btn.disabled = true;
  status.textContent = 'Retouche en cours...';
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/ai-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instruction })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const charData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
    populateWorldEditor(data.world, charData.playableCharacters);
    document.getElementById('worldAiEditStatus').textContent = 'Monde retouché.';
    setTimeout(() => { document.getElementById('worldAiEditStatus').textContent = ''; }, 2500);
  } catch (e) {
    status.textContent = 'Erreur : ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

document.getElementById('startAdventureBtn').onclick = async () => {
  const res = await fetch(`${API}/worlds/${currentWorldId}/saves`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert('Impossible de démarrer une aventure : ' + data.error);
  const worldData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
  showCharacterSelect(worldData.world, worldData.playableCharacters, data.save.id);
};

document.getElementById('deleteWorldBtn').onclick = async () => {
  const title = document.getElementById('worldEditTitle').textContent;
  if (!confirm(`Supprimer le monde "${title}" et toutes ses sauvegardes ? Cette action est irréversible.`)) return;
  await fetch(`${API}/worlds/${currentWorldId}`, { method: 'DELETE' });
  currentWorldId = null;
  showView('home');
  loadHome();
};

// ---------- Character editing (in the world editor) ----------

function skillInputsHtml(skills, idPrefix) {
  return currentWorldSkills.map(skill => `
    <label class="skill-input-label">${escapeHtml(skill)}
      <input type="number" min="1" max="5" id="${idPrefix}-skill-${escapeHtml(skill)}" value="${(skills && skills[skill]) || 3}">
    </label>
  `).join('');
}

function readSkillInputs(idPrefix) {
  const skills = {};
  currentWorldSkills.forEach(skill => {
    const input = document.getElementById(`${idPrefix}-skill-${skill}`);
    skills[skill] = input ? Number(input.value) || 1 : 3;
  });
  return skills;
}

function renderCharacterEditList(characters) {
  const list = document.getElementById('editCharacterList');
  list.innerHTML = '';
  characters.forEach(c => {
    const idPrefix = `char-${c.id}`;
    const card = document.createElement('div');
    card.className = 'character-edit-card';
    card.innerHTML = `
      <input type="text" id="${idPrefix}-name" value="${escapeHtml(c.name)}" placeholder="Nom">
      <textarea id="${idPrefix}-desc" rows="2" placeholder="Description">${escapeHtml(c.description || '')}</textarea>
      <div class="skill-inputs">${skillInputsHtml(c.skills, idPrefix)}</div>
      <div class="character-edit-actions">
        <button class="text-btn char-save-btn">Enregistrer</button>
        <button class="text-btn danger-text char-delete-btn">Supprimer</button>
      </div>
    `;
    card.querySelector('.char-save-btn').onclick = async () => {
      const body = {
        name: document.getElementById(`${idPrefix}-name`).value,
        description: document.getElementById(`${idPrefix}-desc`).value,
        skills: readSkillInputs(idPrefix)
      };
      const res = await fetch(`${API}/worlds/${currentWorldId}/characters/${c.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const status = document.getElementById('characterEditStatus');
      status.textContent = res.ok ? 'Personnage enregistré.' : 'Erreur lors de l\'enregistrement.';
      setTimeout(() => { status.textContent = ''; }, 2000);
    };
    card.querySelector('.char-delete-btn').onclick = async () => {
      if (!confirm(`Supprimer ${c.name} ?`)) return;
      await fetch(`${API}/worlds/${currentWorldId}/characters/${c.id}`, { method: 'DELETE' });
      card.remove();
    };
    list.appendChild(card);
  });
}

document.getElementById('addCharacterBtn').onclick = async () => {
  const res = await fetch(`${API}/worlds/${currentWorldId}/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Nouveau personnage', description: '' })
  });
  const data = await res.json();
  if (!res.ok) return alert('Erreur : ' + data.error);
  const charData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
  renderCharacterEditList(charData.playableCharacters);
};

document.getElementById('generateCharacterBtn').onclick = async () => {
  const input = document.getElementById('aiCharacterDescInput');
  const description = input.value.trim();
  if (!description) return;
  const btn = document.getElementById('generateCharacterBtn');
  btn.disabled = true;
  const status = document.getElementById('characterEditStatus');
  status.textContent = 'Génération en cours...';
  try {
    const res = await fetch(`${API}/worlds/${currentWorldId}/characters/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    input.value = '';
    const charData = await fetch(`${API}/worlds/${currentWorldId}`).then(r => r.json());
    renderCharacterEditList(charData.playableCharacters);
    status.textContent = `${data.character.name} généré.`;
  } catch (e) {
    status.textContent = 'Erreur : ' + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 2500);
  }
};

// ---------- Character selection ----------

async function startNewAdventure(worldId) {
  const res = await fetch(`${API}/worlds/${worldId}/saves`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert('Impossible de démarrer une aventure : ' + data.error);
  const worldData = await fetch(`${API}/worlds/${worldId}`).then(r => r.json());
  showCharacterSelect(worldData.world, worldData.playableCharacters, data.save.id);
}

function showCharacterSelect(world, playableCharacters, saveId) {
  currentSaveId = saveId;
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
  currentWorldSkills = world.skills || [];
  const list = document.getElementById('characterList');
  list.innerHTML = '';
  playableCharacters.forEach(c => {
    const card = document.createElement('div');
    card.className = 'character-card';
    renderCharacterSelectCard(card, c, world.id, saveId);
    list.appendChild(card);
  });
}

function renderCharacterSelectCard(card, c, worldId, saveId) {
  const skillsHtml = Object.entries(c.skills || {})
    .map(([skill, value]) => `<li>${escapeHtml(skill)}: ${value} <span class="skill-label">(${SKILL_LABELS[value] || 'Non noté'})</span></li>`)
    .join('');
  card.innerHTML = `
    <h3>${escapeHtml(c.name)}</h3>
    <p>${escapeHtml(c.description)}</p>
    <ul class="skill-list">${skillsHtml}</ul>
    <div class="character-card-actions">
      <button class="primary-btn choose-character-btn">Choisir ${escapeHtml(c.name)}</button>
      <button class="text-btn edit-character-btn">✏️ Modifier</button>
    </div>
  `;
  card.querySelector('.choose-character-btn').onclick = () => chooseCharacter(saveId, c.id);
  card.querySelector('.edit-character-btn').onclick = () => showCharacterEditForm(card, c, worldId, saveId);
}

function showCharacterEditForm(card, c, worldId, saveId) {
  const idPrefix = `select-char-${c.id}`;
  card.innerHTML = `
    <input type="text" id="${idPrefix}-name" value="${escapeHtml(c.name)}">
    <textarea id="${idPrefix}-desc" rows="2">${escapeHtml(c.description || '')}</textarea>
    <div class="skill-inputs">${skillInputsHtml(c.skills, idPrefix)}</div>
    <div class="character-card-actions">
      <button class="primary-btn char-select-save-btn">Enregistrer</button>
      <button class="text-btn char-select-cancel-btn">Annuler</button>
    </div>
  `;
  card.querySelector('.char-select-save-btn').onclick = async () => {
    const body = {
      name: document.getElementById(`${idPrefix}-name`).value,
      description: document.getElementById(`${idPrefix}-desc`).value,
      skills: readSkillInputs(idPrefix)
    };
    const res = await fetch(`${API}/worlds/${worldId}/characters/${c.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) return alert('Erreur : ' + data.error);
    renderCharacterSelectCard(card, data.character, worldId, saveId);
  };
  card.querySelector('.char-select-cancel-btn').onclick = () => renderCharacterSelectCard(card, c, worldId, saveId);
}

async function chooseCharacter(saveId, characterId) {
  const res = await fetch(`${API}/saves/${saveId}/select-character`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ characterId })
  });
  const data = await res.json();
  if (!res.ok) return alert('Impossible de choisir ce personnage : ' + data.error);
  await openSave(saveId);
}

document.getElementById('backFromCharSelectBtn').onclick = () => {
  currentSaveId = null;
  showView('home');
  loadHome();
};

// ---------- Story ----------

async function openSave(id) {
  currentSaveId = id;
  const data = await fetch(`${API}/saves/${id}`).then(r => r.json());
  if (!data.save.activeCharacterId) {
    showCharacterSelect(data.world, data.playableCharacters, id);
    return;
  }
  currentWorldId = data.world.id;
  showView('story');
  const feed = document.getElementById('chapterFeed');
  feed.innerHTML = '<p class="loading">Chargement de l\'histoire...</p>';
  document.getElementById('storyTitle').textContent = data.world.title;
  const activeCharacter = (data.playableCharacters || []).find(c => c.id === data.save.activeCharacterId);
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
  renderGameOver(data.save.gameOver);
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
  const res = await fetch(`${API}/saves/${currentSaveId}/continue`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) return alert('Impossible de continuer : ' + data.error);
  renderGameOver(null);
  const saveData = await fetch(`${API}/saves/${currentSaveId}`).then(r => r.json());
  renderSuggestions(saveData.turns[saveData.turns.length - 1]?.suggestedActions || []);
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
    const res = await fetch(`${API}/saves/${currentSaveId}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const turn = await res.json();
    if (!res.ok) throw new Error(turn.error || 'Erreur inconnue');
    pending.remove();
    const data = await fetch(`${API}/saves/${currentSaveId}`).then(r => r.json());
    renderChapters(data.turns);
    renderGameOver(data.save.gameOver);
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
  currentSaveId = null;
  lastImageUrl = null;
  showView('home');
  loadHome();
};

document.getElementById('editWorldBtn').onclick = () => openWorldEditor(currentWorldId);

// ---------- Settings ----------

document.getElementById('settingsBtn').onclick = async () => {
  previousView = currentSaveId ? 'story' : (currentWorldId && !views.worldEdit.classList.contains('hidden') ? 'worldEdit' : 'home');
  await loadSettings();
  await loadCostSummary();
  showView('settings');
};
document.getElementById('closeSettingsBtn').onclick = () => {
  showView(previousView);
  if (previousView === 'home') loadHome();
};

async function loadCostSummary() {
  const c = await fetch(`${API}/costs`).then(r => r.json());
  const el = document.getElementById('costSummary');
  const dollars = c.estimatedCostUsd != null ? `~$${c.estimatedCostUsd.toFixed(4)}` : '(inconnu)';
  el.innerHTML = `
    <div class="cost-row"><span>Appels IA</span><strong>${c.calls}</strong></div>
    <div class="cost-row"><span>Jetons entrée</span><strong>${c.inputTokens.toLocaleString('fr-FR')}</strong></div>
    <div class="cost-row"><span>Jetons sortie</span><strong>${c.outputTokens.toLocaleString('fr-FR')}</strong></div>
    <div class="cost-row"><span>Coût estimé</span><strong>${dollars}</strong></div>
    ${c.hasUnknownCost ? '<p class="hint-inline">Certains appels (ex. OpenRouter) n\'ont pas de tarif connu et ne sont pas inclus dans l\'estimation.</p>' : ''}
  `;
}

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

loadHome();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
