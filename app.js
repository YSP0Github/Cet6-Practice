const libraryData = Array.isArray(window.libraryData) ? window.libraryData : [];

const VALID_LEVELS = ['cet6', 'cet4'];
let currentLevel = localStorage.getItem('cetLevel') || 'cet6';
if (!VALID_LEVELS.includes(currentLevel)) currentLevel = 'cet6';

function getFilteredData() {
  return libraryData.filter(entry => (entry.level || 'cet6') === currentLevel);
}

function storageKey(suffix) {
  return `${currentLevel}_${suffix}`;
}

function stripExtension(name) {
  return name.replace(/\.(pdf|mp3)$/i, '').trim();
}

function extractSetLabel(name) {
  const normalized = name.replace(/\s+/g, '');
  const match = normalized.match(/第(\d+)套/);
  if (match) {
    return `第${match[1]}套`;
  }
  const alt = normalized.match(/全?(\d)套/);
  if (alt) {
    return `第${alt[1]}套`;
  }
  return '';
}

function getButtonLabel(resource, fallbackIndex = 0) {
  const setLabel = extractSetLabel(resource.name);
  const base = stripExtension(resource.name);
  if (resource.type === '真题') {
    return setLabel || `第${fallbackIndex + 1}套`;
  }
  if (resource.type === '解析') {
    return setLabel ? `${setLabel}解析` : `${base}解析`;
  }
  if (resource.type === '听力') {
    return setLabel ? `${setLabel}听力` : base;
  }
  return base || '打开';
}

function isPdfResource(resource) {
  return resource.type === '真题' && resource.path.toLowerCase().endsWith('.pdf');
}

function getViewerPdfResource(entry, clickedResource) {
  if (clickedResource && isPdfResource(clickedResource)) {
    return clickedResource;
  }
  if (clickedResource && clickedResource.type === '解析' && clickedResource.path.toLowerCase().endsWith('.pdf')) {
    return clickedResource;
  }
  return entry.resources.find(resource => isPdfResource(resource));
}

const YEAR_MONTH_PATTERN = /(20\d{2})[^\d]{0,3}(\d{1,2})?/;
const PREVIEWABLE_TYPES = new Set(['真题', '解析', '听力']);

function isPrimaryQuestionResource(resource) {
  return resource.type === '真题' && resource.path.toLowerCase().endsWith('.pdf');
}

function getUniqueQuestionResources(entry) {
  const seen = new Set();
  const primary = [];
  entry.resources.forEach((resource, index) => {
    if (!isPrimaryQuestionResource(resource)) {
      return;
    }
    const key = extractSetLabel(resource.name) || `auto-${index}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    primary.push({ resource, index, label: extractSetLabel(resource.name), key });
  });
  return primary;
}

function getEntrySortValue(entry) {
  const year = Number(entry.year) || 0;
  const month = Number(entry.month) || 0;
  if (year) {
    return year * 100 + month;
  }
  const match = (entry.title || '').match(YEAR_MONTH_PATTERN);
  if (match) {
    const derivedYear = Number(match[1]) || 0;
    const derivedMonth = Number(match[2] || 0);
    return derivedYear * 100 + derivedMonth;
  }
  return 0;
}

function formatEntryTag(entry) {
  const year = entry.year || '';
  const month = Number(entry.month);
  if (year && Number.isFinite(month) && month > 0) {
    return `${year}.${String(month).padStart(2, '0')}`;
  }
  return year || entry.title || '最新资源';
}

function getEntrySummary(entry) {
  const counts = { 真题: 0, 解析: 0, 听力: 0 };
  entry.resources.forEach(resource => {
    if (counts.hasOwnProperty(resource.type)) {
      counts[resource.type] += 1;
    }
  });
  const segments = [];
  if (counts.真题) segments.push(`${counts.真题} 份真题`);
  if (counts.解析) segments.push(`${counts.解析} 份解析`);
  if (counts.听力) segments.push(`${counts.听力} 段听力`);
  return segments.join(' · ') || '包含多类型资源';
}

function getLatestEntries(limit = 3) {
  return getFilteredData()
    .map(entry => {
      const originalIndex = libraryData.indexOf(entry);
      return { entry, entryIndex: originalIndex };
    })
    .sort((a, b) => {
      const diff = getEntrySortValue(b.entry) - getEntrySortValue(a.entry);
      if (diff !== 0) {
        return diff;
      }
      return (b.entry.title || '').localeCompare(a.entry.title || '', 'zh-Hans-CN');
    })
    .slice(0, limit);
}

function getPreviewResourceIndexes(entry) {
  const indexes = entry.resources
    .map((resource, index) => ({ resource, index }))
    .filter(item => PREVIEWABLE_TYPES.has(item.resource.type));
  if (indexes.length === 0) {
    return entry.resources.map((resource, index) => ({ resource, index }));
  }
  return indexes;
}

const plans = [
  { id: 'plan-1', label: '完成一套真题练习' },
  { id: 'plan-2', label: '听力至少听两遍' },
  { id: 'plan-3', label: '记录一个错题点' }
];

const featuredCards = document.getElementById('featuredCards');
const resourceLibrary = document.getElementById('resourceLibrary');
const searchInput = document.getElementById('searchInput');
const recentList = document.getElementById('recentList');
const audioList = document.getElementById('audioList');
const notesArea = document.getElementById('notesArea');
const saveNotesButton = document.getElementById('saveNotes');
const clearNotesButton = document.getElementById('clearNotes');
const planItems = document.getElementById('planItems');
const toggleImmersiveButton = document.getElementById('toggleImmersive');

let favorites = JSON.parse(localStorage.getItem(storageKey('Favorites')) || '{}');
let recentResources = JSON.parse(localStorage.getItem(storageKey('Recent')) || '[]');
let currentFilter = '';

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':').replace(/%2F/g, '/');
}

function saveFavorites() {
  try { localStorage.setItem(storageKey('Favorites'), JSON.stringify(favorites)); } catch (e) { /* quota exceeded */ }
}

function saveRecent() {
  try { localStorage.setItem(storageKey('Recent'), JSON.stringify(recentResources)); } catch (e) { /* quota exceeded */ }
}

function logRecent(resource) {
  recentResources = recentResources.filter(item => item.path !== resource.path);
  recentResources.unshift(resource);
  if (recentResources.length > 6) {
    recentResources.pop();
  }
  saveRecent();
  renderRecent();
}

function toggleFavorite(path) {
  if (favorites[path]) {
    delete favorites[path];
  } else {
    favorites[path] = true;
  }
  saveFavorites();
  renderLibrary(currentFilter);
}

function getIcon(type) {
  switch (type) {
    case '听力': return '🎧';
    case '解析': return '📘';
    case '真题': return '📄';
    default: return '📁';
  }
}

function renderFeatured() {
  featuredCards.innerHTML = '';
  const latestEntries = getLatestEntries();
  if (latestEntries.length === 0) {
    featuredCards.innerHTML = '<p class="empty-state">尚未发现本地真题资源，请先运行 generate_manifest.py。</p>';
    return;
  }
  latestEntries.forEach(({ entry, entryIndex }) => {
    const card = document.createElement('article');
    card.className = 'featured-card';
    card.innerHTML = `
      <div class="tag">${formatEntryTag(entry)}</div>
      <h3>${entry.title}</h3>
      <p>${getEntrySummary(entry)}</p>
      <div class="actions"></div>
    `;
    const actions = card.querySelector('.actions');
    const questions = getUniqueQuestionResources(entry);
    const primary = document.createElement('div');
    primary.className = 'actions-primary';
    if (questions.length === 0) {
      primary.innerHTML = '<span class="empty-state" style="font-size: 0.9rem;">该目录暂无真题 PDF</span>';
    } else {
      primary.innerHTML = questions.slice(0, 3).map((item, idx) => `
        <button type="button" class="button button-secondary open-viewer-button" data-entry-index="${entryIndex}" data-resource-index="${item.index}">
          ${item.label || `第${idx + 1}套`}
        </button>
      `).join('');
    }
    actions.appendChild(primary);
    featuredCards.appendChild(card);
  });
}

function buildResourceCard(entry, entryIndex) {
  const card = document.createElement('article');
  card.className = 'library-card';
  card.innerHTML = `
    <div class="tag">${entry.year} · ${entry.tags.join(' · ')}</div>
    <h3>${entry.title}</h3>
    <div class="resource-list"></div>
  `;
  const list = card.querySelector('.resource-list');

  const typeOrder = ['真题', '解析', '听力'];
  const grouped = {};
  entry.resources.forEach((resource, resourceIndex) => {
    if (!grouped[resource.type]) grouped[resource.type] = [];
    grouped[resource.type].push({ resource, resourceIndex });
  });

  typeOrder.forEach(type => {
    const items = grouped[type];
    if (!items || items.length === 0) return;
    const section = document.createElement('div');
    section.className = 'resource-group';
    section.innerHTML = `<div class="resource-group-title">${getIcon(type)} ${type}</div>`;
    items.forEach(({ resource, resourceIndex }) => {
      const item = document.createElement('div');
      item.className = 'resource-item';
      item.innerHTML = `
        <span class="resource-name">${stripExtension(resource.name)}</span>
        <div class="resource-item-actions">
          <button type="button" class="button button-secondary open-viewer-button" data-entry-index="${entryIndex}" data-resource-index="${resourceIndex}">${getButtonLabel(resource, resourceIndex)}</button>
          <button type="button" class="favorite-button" data-path="${resource.path}">${favorites[resource.path] ? '★' : '☆'}</button>
        </div>
      `;
      section.appendChild(item);
    });
    list.appendChild(section);
  });

  return card;
}

function renderLibrary(filter = '') {
  currentFilter = filter;
  const normalized = filter.trim().toLowerCase();
  const levelData = getFilteredData();
  const filtered = levelData.filter(entry => {
    if (!normalized) return true;
    if (entry.title.toLowerCase().includes(normalized) || entry.year.includes(normalized) || entry.tags.some(tag => tag.toLowerCase().includes(normalized))) {
      return true;
    }
    return entry.resources.some(resource => resource.name.toLowerCase().includes(normalized) || resource.type.toLowerCase().includes(normalized));
  });
  resourceLibrary.innerHTML = '';
  if (filtered.length === 0) {
    resourceLibrary.innerHTML = '<p class="empty-state">未找到匹配资源，请尝试其他关键词。</p>';
    return;
  }
  filtered.forEach(entry => {
    const idx = libraryData.indexOf(entry);
    resourceLibrary.appendChild(buildResourceCard(entry, idx));
  });
}

function renderRecent() {
  recentList.innerHTML = '';
  if (recentResources.length === 0) {
    recentList.innerHTML = '<li class="empty-state">暂无最近访问</li>';
    return;
  }
  recentResources.forEach(resource => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="${encodePath(resource.path)}" target="_blank" rel="noreferrer">${resource.name}</a>`;
    li.querySelector('a').addEventListener('click', () => logRecent(resource));
    recentList.appendChild(li);
  });
}

function openPreviewPage(entryIndex, resourceIndex) {
  const entry = libraryData[entryIndex];
  if (!entry) {
    return;
  }
  const resource = entry.resources[resourceIndex];
  if (!resource) {
    return;
  }
  const shouldPreview = resource.type === '真题' || resource.type === '解析' || resource.type === '听力';
  if (shouldPreview) {
    window.open(`preview.html?entry=${encodeURIComponent(entryIndex)}&resource=${encodeURIComponent(resourceIndex)}`, '_blank');
    return;
  }
  window.open(encodePath(resource.path), '_blank');
}

function renderAudio() {
  audioList.innerHTML = '';
  const audioResources = getFilteredData().flatMap(entry => entry.resources.filter(resource => resource.type === '听力'));
  audioResources.forEach(resource => {
    const card = document.createElement('article');
    card.className = 'audio-card';
    card.innerHTML = `
      <h3>${resource.name}</h3>
      <p>${resource.type} · ${resource.name.replace(/\.mp3$/, '')}</p>
      <audio controls preload="none" src="${encodePath(resource.path)}"></audio>
    `;
    card.querySelector('audio').addEventListener('play', () => logRecent(resource));
    audioList.appendChild(card);
  });
}

function loadNotes() {
  notesArea.value = localStorage.getItem(storageKey('Notes')) || '';
}

function saveNotes() {
  try { localStorage.setItem(storageKey('Notes'), notesArea.value); } catch (e) { /* quota exceeded */ }
  saveNotesButton.textContent = '已保存';
  const status = document.getElementById('saveStatus');
  if (status) status.textContent = '笔记已保存';
  setTimeout(() => {
    saveNotesButton.textContent = '保存笔记';
    if (status) status.textContent = '';
  }, 1200);
}

function clearNotes() {
  if (confirm('确定要清空笔记吗？')) {
    notesArea.value = '';
    localStorage.removeItem('cet6Notes');
  }
}

function renderPlans() {
  planItems.innerHTML = '';
  plans.forEach(plan => {
    const li = document.createElement('li');
    const checked = localStorage.getItem(plan.id) === 'true';
    li.innerHTML = `
      <label>
        <input type="checkbox" data-id="${plan.id}" ${checked ? 'checked' : ''} /> ${plan.label}
      </label>
    `;
    planItems.appendChild(li);
  });
}

function updatePlan(event) {
  const target = event.target;
  if (target.matches('input[type="checkbox"]')) {
    localStorage.setItem(target.dataset.id, target.checked);
  }
}

function setupEventListeners() {
  document.getElementById('levelSwitcher').addEventListener('click', event => {
    const tab = event.target.closest('.level-tab');
    if (tab) switchLevel(tab.dataset.level);
  });

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderLibrary(searchInput.value), 200);
  });
  saveNotesButton.addEventListener('click', saveNotes);
  clearNotesButton.addEventListener('click', clearNotes);
  planItems.addEventListener('change', updatePlan);
  toggleImmersiveButton.addEventListener('click', () => {
    const target = getLatestEntries(1)[0];
    if (!target) {
      alert('尚未发现真题资源，请先运行 generate_manifest.py。');
      return;
    }
    const previewable = getPreviewResourceIndexes(target.entry);
    if (previewable.length === 0) {
      alert('该目录暂未包含可预览的真题或解析。');
      return;
    }
    openPreviewPage(target.entryIndex, previewable[0].index);
  });

  featuredCards.addEventListener('click', event => {
    if (event.target.matches('.open-viewer-button')) {
      openPreviewPage(event.target.dataset.entryIndex, event.target.dataset.resourceIndex);
      return;
    }
  });

  resourceLibrary.addEventListener('click', event => {
    if (event.target.matches('.favorite-button')) {
      toggleFavorite(event.target.dataset.path);
      return;
    }
    if (event.target.matches('.open-viewer-button')) {
      openPreviewPage(event.target.dataset.entryIndex, event.target.dataset.resourceIndex);
      return;
    }
  });
}

function renderLevelSwitcher() {
  document.querySelectorAll('.level-tab').forEach(tab => {
    const isActive = tab.dataset.level === currentLevel;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function updateHeaderTitle() {
  const h1 = document.getElementById('siteTitle');
  const desc = document.getElementById('siteDesc');
  if (h1) {
    h1.textContent = currentLevel === 'cet4'
      ? '大学英语四级真题练习系统'
      : '大学英语六级真题练习系统';
  }
  if (desc) {
    desc.textContent = currentLevel === 'cet4'
      ? '把四级真题、听力、解析与错题笔记集中到一个界面，减少切换次数，保持沉浸式复习节奏。'
      : '把真题、听力、解析与错题笔记集中到一个界面，减少切换次数，保持沉浸式复习节奏。';
  }
}

function switchLevel(level) {
  if (!VALID_LEVELS.includes(level) || level === currentLevel) return;
  currentLevel = level;
  localStorage.setItem('cetLevel', level);
  favorites = JSON.parse(localStorage.getItem(storageKey('Favorites')) || '{}');
  recentResources = JSON.parse(localStorage.getItem(storageKey('Recent')) || '[]');
  renderFeatured();
  renderLibrary(searchInput.value);
  renderRecent();
  renderAudio();
  loadNotes();
  renderLevelSwitcher();
  updateHeaderTitle();
}

function init() {
  renderLevelSwitcher();
  updateHeaderTitle();
  renderFeatured();
  renderLibrary();
  renderRecent();
  renderAudio();
  loadNotes();
  renderPlans();
  setupEventListeners();
}

init();
