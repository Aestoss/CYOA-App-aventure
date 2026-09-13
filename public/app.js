const API = '/api';

const views = {
  home: document.getElementById('view-home'),
  story: document.getElementById('view-story'),
  settings: document.getElementById('view-settings')
};

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
    btn.innerHTML = `${escapeHtml(w.title)}<small>${escapeHtml(w.tone || '')}</small>`;
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
    await openWorld(data.world.id);
  } catch (e) {
    alert('Impossible de créer le monde : ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Commencer';
  }
};

// ---------- Story ----------

async function openWorld(id) {
  currentWorldId = id;
  showView('story');
  const feed = document.getElementById('chapterFeed');
  feed.innerHTML = '<p class="loading">Chargement de l\'histoire...</p>';
  const data = await fetch(`${API}/worlds/${id}`).then(r => r.json());
  document.getElementById('storyTitle').textContent = data.world.title;
  renderChapters(data.turns);
}

function renderChapters(turns) {
  const feed = document.getElementById('chapterFeed');
  feed.innerHTML = '';
  turns.forEach(t => {
    const div = document.createElement('div');
    div.className = 'chapter';
    const actionLine = t.turnNumber === 0 ? '' : `<div class="player-action">→ ${escapeHtml(t.playerAction)}</div>`;
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
  ['anthropic', 'openai', 'openrouter', 'stability', 'replicate'].forEach(p => {
    const field = document.getElementById(`key-${p}`);
    field.placeholder = s.apiKeys[p] ? '•••••••• (déjà enregistrée)' : field.placeholder;
  });
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  const apiKeys = {};
  ['anthropic', 'openai', 'openrouter', 'stability', 'replicate'].forEach(p => {
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
  ['anthropic', 'openai', 'openrouter', 'stability', 'replicate'].forEach(p => {
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
