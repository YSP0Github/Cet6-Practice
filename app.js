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
let notesManager = null;
let currentCategoryFilter = 'all';
let currentSearchQuery = '';

function showToast(message) {
  var existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(function () { toast.classList.add('visible'); });
  var duration = message.length > 40 ? 6000 : 3000;
  setTimeout(function () {
    toast.classList.remove('visible');
    setTimeout(function () { toast.remove(); }, 300);
  }, duration);
}

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
  if (!notesManager) return;
  notesArea.value = notesManager.getQuickNote();
  renderEntries();
}

function saveNotes() {
  if (!notesManager) return;
  notesManager.saveQuickNote(notesArea.value);
  saveNotesButton.textContent = '已保存';
  const status = document.getElementById('saveStatus');
  if (status) status.textContent = '笔记已保存';
  setTimeout(() => {
    saveNotesButton.textContent = '保存';
    if (status) status.textContent = '';
  }, 1200);
}

function clearNotes() {
  if (confirm('确定要清空快速笔记吗？')) {
    notesArea.value = '';
    notesManager.clearQuickNote();
  }
}

function renderEntries() {
  const list = document.getElementById('notesEntriesList');
  if (!list || !notesManager) return;

  let entries = notesManager.searchEntries(currentSearchQuery, currentCategoryFilter);

  // Sort: pinned first, then by updatedAt desc
  entries.sort(function (a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  if (entries.length === 0) {
    list.innerHTML = '<div class="notes-empty">' +
      (currentSearchQuery || currentCategoryFilter !== 'all' ? '没有找到匹配的笔记' : '还没有笔记，添加一条试试吧') +
      '</div>';
    return;
  }

  list.innerHTML = entries.map(function (entry) {
    var examTag = entry.examId
      ? '<span class="note-exam-tag">' + entry.examId + '</span>'
      : '';
    var tagsHtml = entry.tags.length
      ? '<div class="note-entry-tags">' + entry.tags.map(function (t) { return '<span class="note-tag">' + t + '</span>'; }).join('') + '</div>'
      : '';
    return '<div class="note-entry-card' + (entry.pinned ? ' pinned' : '') + '" data-id="' + entry.id + '">' +
      '<div class="note-entry-meta">' +
        '<span class="note-entry-category cat-' + entry.category + '">' + entry.category + '</span>' +
        examTag +
        '<span class="note-entry-time">' + NotesManager.formatTime(entry.updatedAt) + '</span>' +
        '<button class="note-entry-pin" data-action="pin" title="' + (entry.pinned ? '取消置顶' : '置顶') + '">' + (entry.pinned ? '📌' : '📍') + '</button>' +
        '<button class="note-entry-delete" data-action="delete" title="删除">🗑</button>' +
      '</div>' +
      '<p class="note-entry-text">' + escapeHtml(entry.text) + '</p>' +
      tagsHtml +
    '</div>';
  }).join('');
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function updateStorageDisplay() {
  if (!notesManager) return;
  var info = notesManager.getStorageInfo();
  var display = document.getElementById('storageLocationDisplay');
  var hint = document.getElementById('storageHint');
  var resetBtn = document.getElementById('resetStorageBtn');
  var chooseBtn = document.getElementById('chooseFolderBtn');

  if (info.hasFolder) {
    if (display) {
      display.textContent = info.folderName;
      display.title = '浏览器安全限制，无法获取完整路径';
      display.classList.add('custom-folder');
    }
    if (hint) hint.textContent = '笔记会自动保存到此文件夹。';
    if (resetBtn) resetBtn.style.display = '';
    if (chooseBtn) chooseBtn.textContent = '更换文件夹...';
  } else {
    if (display) {
      display.textContent = info.supported ? '浏览器本地存储' : '浏览器本地存储（当前浏览器不支持文件夹选择）';
      display.classList.remove('custom-folder');
    }
    if (hint) hint.textContent = '数据保存在浏览器 localStorage 中，清除浏览器数据会丢失笔记' + (info.supported ? '。选择文件夹后可自动同步到本地文件。' : '。建议使用 Edge 或 Chrome 浏览器获得文件夹同步功能。');
    if (resetBtn) resetBtn.style.display = 'none';
    if (chooseBtn) chooseBtn.textContent = '选择文件夹...';
  }
}

function addEntry() {
  var textArea = document.getElementById('newEntryText');
  var catSelect = document.getElementById('newEntryCategory');
  var tagsInput = document.getElementById('newEntryTags');
  var text = textArea.value.trim();
  if (!text) return;

  var tags = tagsInput.value.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
  notesManager.addEntry(text, catSelect.value, tags);

  textArea.value = '';
  tagsInput.value = '';
  currentSearchQuery = '';
  currentCategoryFilter = 'all';
  var searchEl = document.getElementById('notesSearch');
  if (searchEl) searchEl.value = '';
  document.querySelectorAll('#categoryFilter .category-chip').forEach(function (c) {
    c.classList.toggle('active', c.dataset.cat === 'all');
  });
  renderEntries();
}

function renderPlans() {
  if (!notesManager) return;
  var today = notesManager.getTodayCheckins();
  var streak = notesManager.getStreak();
  var history = notesManager.getHistory(7);
  var stats = notesManager.getCompletionStats();

  // Date display
  var planDate = document.getElementById('planDate');
  if (planDate) {
    var d = new Date();
    var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    planDate.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weekdays[d.getDay()];
  }

  // Streak display
  var planStreak = document.getElementById('planStreak');
  if (planStreak) {
    if (streak > 0) {
      planStreak.innerHTML = '🔥 连续打卡 <strong>' + streak + '</strong> 天';
      planStreak.className = 'plan-streak active';
    } else {
      planStreak.innerHTML = '今天还没有完成哦，加油！';
      planStreak.className = 'plan-streak';
    }
  }

  // Task list
  planItems.innerHTML = '';
  today.tasks.forEach(function (task) {
    var li = document.createElement('li');
    li.className = 'plan-task-item' + (task.checked ? ' done' : '');
    li.innerHTML =
      '<label class="plan-task-label">' +
      '<input type="checkbox" data-id="' + task.id + '"' + (task.checked ? ' checked' : '') + ' />' +
      '<span class="plan-task-text">' + escapeHtml(task.label) + '</span>' +
      '<button type="button" class="plan-task-remove" data-id="' + task.id + '" title="删除任务">×</button>' +
      '</label>';
    planItems.appendChild(li);
  });

  // History (last 7 days)
  var planHistory = document.getElementById('planHistory');
  if (planHistory) {
    var histHtml = '<div class="plan-history-title">近 7 天</div><div class="plan-history-dots">';
    history.slice().reverse().forEach(function (day) {
      var cls = 'plan-dot';
      if (day.total > 0 && day.allDone) cls += ' done';
      else if (day.total > 0) cls += ' partial';
      histHtml += '<div class="' + cls + '" title="' + day.date + '：' + day.done + '/' + day.total + '">';
      histHtml += '<span class="plan-dot-label">' + day.label + '</span>';
      histHtml += '<span class="plan-dot-weekday">' + day.weekday + '</span>';
      histHtml += '</div>';
    });
    histHtml += '</div>';
    planHistory.innerHTML = histHtml;
  }

  // Stats
  var planStats = document.getElementById('planStats');
  if (planStats && stats.totalDays > 0) {
    planStats.innerHTML = '累计打卡 <strong>' + stats.totalDays + '</strong> 天，完成 <strong>' + stats.completedDays + '</strong> 天，完成率 <strong>' + stats.rate + '%</strong>';
  } else if (planStats) {
    planStats.innerHTML = '';
  }
}

function updatePlan(event) {
  var target = event.target;
  if (!notesManager) return;

  // Handle checkbox toggle
  if (target.matches('input[type="checkbox"]')) {
    notesManager.setTaskCheck(target.dataset.id, target.checked);
    renderPlans();
  }

  // Handle task removal
  if (target.matches('.plan-task-remove')) {
    notesManager.removeDailyTask(target.dataset.id);
    renderPlans();
  }
}

function addDailyTask() {
  var input = document.getElementById('planAddInput');
  if (!input || !notesManager) return;
  var label = input.value.trim();
  if (!label) return;
  notesManager.addDailyTask(label);
  input.value = '';
  renderPlans();
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
  planItems.addEventListener('click', updatePlan);
  var planAddBtn = document.getElementById('planAddBtn');
  var planAddInput = document.getElementById('planAddInput');
  if (planAddBtn) planAddBtn.addEventListener('click', addDailyTask);
  if (planAddInput) {
    planAddInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addDailyTask();
    });
  }
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

  // ── Notes: add entry ──
  const addEntryBtn = document.getElementById('addEntryBtn');
  if (addEntryBtn) {
    addEntryBtn.addEventListener('click', addEntry);
  }

  // ── Notes: entry list actions (pin / delete) ──
  const entriesList = document.getElementById('notesEntriesList');
  if (entriesList) {
    entriesList.addEventListener('click', event => {
      const btn = event.target.closest('[data-action]');
      if (!btn || !notesManager) return;
      const card = btn.closest('.note-entry-card');
      if (!card) return;
      const id = card.dataset.id;
      if (btn.dataset.action === 'delete') {
        if (confirm('确定删除这条笔记？')) {
          notesManager.deleteEntry(id);
          renderEntries();
        }
      } else if (btn.dataset.action === 'pin') {
        notesManager.togglePin(id);
        renderEntries();
      }
    });
  }

  // ── Notes: search ──
  const notesSearch = document.getElementById('notesSearch');
  if (notesSearch) {
    let searchTimer;
    notesSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentSearchQuery = notesSearch.value;
        renderEntries();
      }, 200);
    });
  }

  // ── Notes: category filter ──
  const categoryFilter = document.getElementById('categoryFilter');
  if (categoryFilter) {
    categoryFilter.addEventListener('click', event => {
      const chip = event.target.closest('.category-chip');
      if (!chip) return;
      categoryFilter.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentCategoryFilter = chip.dataset.cat;
      renderEntries();
    });
  }

  // ── Notes: export / import ──
  const exportBtn = document.getElementById('exportNotesBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (notesManager) notesManager.exportToFile();
    });
  }
  const importBtn = document.getElementById('importNotesBtn');
  const importFile = document.getElementById('importNotesFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
      if (importFile.files.length === 0 || !notesManager) return;
      notesManager.importFromFile(importFile.files[0]).then(() => {
        loadNotes();
        renderPlans();
        importFile.value = '';
      }).catch(err => {
        alert('导入失败：' + err.message);
        importFile.value = '';
      });
    });
  }

  // ── Data reminder dismiss ──
  const dismissBtn = document.getElementById('dismissReminder');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      localStorage.setItem('hideDataReminder', '1');
      const reminder = document.getElementById('dataReminder');
      if (reminder) reminder.hidden = true;
    });
  }

  // ── Storage settings: choose folder ──
  const storageDisplay = document.getElementById('storageLocationDisplay');
  if (storageDisplay) {
    storageDisplay.addEventListener('click', () => {
      if (!notesManager) return;
      var info = notesManager.getStorageInfo();
      if (info.hasFolder) {
        showToast('当前存储文件夹：' + info.folderName);
      }
    });
  }
  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  if (chooseFolderBtn) {
    chooseFolderBtn.addEventListener('click', () => {
      if (!notesManager) return;
      notesManager.chooseFolder().then(function () {
        var info = notesManager.getStorageInfo();
        if (info.hasFolder) {
          showToast('已切换到文件夹：' + info.folderName + '\n笔记将自动保存到此目录。');
        }
      }).catch(err => {
        if (err.name !== 'AbortError') {
          alert('选择文件夹失败：' + err.message);
        }
      });
    });
  }

  // ── Storage settings: reset to default ──
  const resetStorageBtn = document.getElementById('resetStorageBtn');
  if (resetStorageBtn) {
    resetStorageBtn.addEventListener('click', () => {
      if (!notesManager) return;
      if (confirm('恢复为浏览器本地存储？已保存到文件夹的文件不会被删除。')) {
        notesManager.resetStorage();
      }
    });
  }
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
  if (notesManager) notesManager.switchLevel(currentLevel);
  renderFeatured();
  renderLibrary(searchInput.value);
  renderRecent();
  renderAudio();
  loadNotes();
  renderPlans();
  renderLevelSwitcher();
  updateHeaderTitle();
}

function init() {
  notesManager = new NotesManager(currentLevel);
  notesManager._onStorageChange = updateStorageDisplay;
  renderLevelSwitcher();
  updateHeaderTitle();
  renderFeatured();
  renderLibrary();
  renderRecent();
  renderAudio();
  loadNotes();
  renderPlans();
  setupEventListeners();
  updateStorageDisplay();
  NotesManager.initEmojiBars();

  // Data reminder banner
  var reminder = document.getElementById('dataReminder');
  if (reminder && localStorage.getItem('hideDataReminder') !== '1') {
    reminder.hidden = false;
  }
}

init();
