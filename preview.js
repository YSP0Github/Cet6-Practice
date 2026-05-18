function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    entryIndex: Number(params.get('entry')),
    resourceIndex: Number(params.get('resource'))
  };
}

function getSetLabel(name = '') {
  const normalized = name.replace(/\s+/g, '');
  const directMatch = normalized.match(/第(\d+)套/);
  if (directMatch) {
    return `第${directMatch[1]}套`;
  }
  const numericMatch = normalized.match(/_(\d)(?:_|\.|$)/);
  if (numericMatch) {
    return `第${numericMatch[1]}套`;
  }
  return '';
}

function stripResourceExtension(name = '') {
  return name.replace(/\.(pdf|mp3)$/i, '').trim();
}

function formatShortcutGroupTitle(entry) {
  const year = entry.year;
  const month = Number(entry.month);
  if (year && Number.isFinite(month) && month > 0) {
    return `${year}年${String(month).padStart(2, '0')}月`;
  }
  if (year) {
    return `${year}年`;
  }
  const match = (entry.title || '').match(/(20\d{2})[^\d]{0,3}(\d{1,2})?/);
  if (match) {
    const detectedYear = match[1];
    const detectedMonth = match[2] ? String(Number(match[2])).padStart(2, '0') : '';
    return detectedMonth ? `${detectedYear}年${detectedMonth}月` : `${detectedYear}年`;
  }
  return entry.title || '本年度';
}

function getPdfResource(entry, setLabel, type) {
  const targetNumberMatch = setLabel.match(/第(\d+)套/);
  const targetNumber = targetNumberMatch ? targetNumberMatch[1] : null;
  return entry.resources.find(resource => {
    if (resource.type !== type) {
      return false;
    }
    if (setLabel && resource.name.includes(setLabel)) {
      return true;
    }
    if (targetNumber) {
      const fallbackPattern = new RegExp(`_(?:${targetNumber})(?:_|\\.|$)`);
      return fallbackPattern.test(resource.name);
    }
    return false;
  });
}

function wrapPath(path) {
  return path.split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':').replace(/%2F/g, '/');
}

const SPLIT_STORAGE_KEY = 'previewSplitPercent';
const PARSE_VISIBILITY_KEY = 'previewParseHidden';
const SPLIT_MIN = 45;
const SPLIT_MAX = 80;
const DEFAULT_SPLIT = 60;
let parseToggleButton = null;
let resizerElement = null;
let splitPercent = DEFAULT_SPLIT;
let activePointerId = null;
let notesManager = null;

function showMessage(message) {
  const title = document.getElementById('previewTitle');
  const subtitle = document.getElementById('previewSubtitle');
  title.textContent = '无法加载预览';
  subtitle.textContent = message;
  const mainPdf = document.getElementById('mainPdf');
  const parsePdf = document.getElementById('parsePdf');
  if (mainPdf) {
    mainPdf.style.display = 'none';
  }
  if (parsePdf) {
    parsePdf.style.display = 'none';
  }
  const audioBar = document.getElementById('previewAudioBar');
  if (audioBar) {
    audioBar.classList.remove('has-content');
  }
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function initPdfJsWorker() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.bootcdn.net/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

function showPdfLoading(viewer, fileName) {
  if (!viewer) return;
  viewer.innerHTML = `
    <div class="mobile-pdf-loading">
      <div class="mobile-pdf-spinner"></div>
      <p>正在加载 ${fileName || 'PDF'}...</p>
      <p class="mobile-pdf-loading-hint">文件较大时需要等待片刻</p>
    </div>
  `;
}

function showPdfError(viewer, fileName, pdfUrl) {
  if (!viewer) return;
  viewer.innerHTML = `
    <div class="mobile-pdf-fallback">
      <div class="mobile-pdf-icon">📄</div>
      <p class="mobile-pdf-name">${fileName || 'PDF'}</p>
      <p style="color:var(--muted);font-size:0.85rem;margin:0 0 12px;">加载失败，请检查网络后重试</p>
      <a class="button button-primary mobile-pdf-open" href="${wrapPath(pdfUrl)}" target="_blank" rel="noopener">在新页面打开</a>
    </div>
  `;
}

async function renderPdfToCanvas(canvasId, pdfUrl) {
  if (typeof pdfjsLib === 'undefined') {
    const viewer = document.getElementById(canvasId).closest('.mobile-pdf-viewer');
    showPdfError(viewer, pdfUrl.split('/').pop(), pdfUrl);
    return;
  }
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const viewer = canvas.closest('.mobile-pdf-viewer');
  const fileName = pdfUrl.split('/').pop();
  showPdfLoading(viewer, fileName);
  try {
    const loadingTask = pdfjsLib.getDocument(wrapPath(pdfUrl));
    const pdf = await loadingTask.promise;
    const containerWidth = viewer ? viewer.clientWidth : window.innerWidth;
    const maxWidth = Math.min(containerWidth - 24, 800);
    const allPages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const scale = maxWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });
      allPages.push({ page, height: scaledViewport.height });
    }
    const totalHeight = allPages.reduce((sum, p) => sum + p.height, 0);
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    canvas.style.width = maxWidth + 'px';
    canvas.style.height = totalHeight + 'px';
    const ctx = canvas.getContext('2d');
    let y = 0;
    for (const { page, height } of allPages) {
      const viewport = page.getViewport({ scale: maxWidth / page.getViewport({ scale: 1 }).width });
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;
      const tempCtx = tempCanvas.getContext('2d');
      await page.render({ canvasContext: tempCtx, viewport }).promise;
      ctx.drawImage(tempCanvas, 0, y, viewport.width, viewport.height);
      y += height;
    }
    if (viewer) {
      viewer.innerHTML = '';
      viewer.appendChild(canvas);
    }
    canvas.dataset.loaded = 'true';
  } catch (err) {
    console.error('PDF render failed:', err);
    showPdfError(viewer, fileName, pdfUrl);
  }
}

function initMobileTabs() {
  const tabBar = document.querySelector('.mobile-tab-bar');
  if (!tabBar) return;
  tabBar.addEventListener('click', event => {
    const tab = event.target.closest('.mobile-tab');
    if (!tab) return;
    const targetId = tab.dataset.tab;
    document.querySelectorAll('.mobile-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.mobile-tab-content').forEach(c => c.style.display = 'none');
    const targetMap = { audio: 'mobileTabAudio', exam: 'mobileTabExam', parse: 'mobileTabParse' };
    const target = document.getElementById(targetMap[targetId]);
    if (target) target.style.display = '';
  });
}

function isAudioPath(path = '') {
  return /\.(mp3|m4a|wav|aac)$/i.test(path);
}

function renderAudioList(entry, setLabel) {
  const audioBar = document.getElementById('previewAudioBar');
  const audioPlayer = document.getElementById('previewAudioPlayer');
  if (!audioBar || !audioPlayer) {
    return;
  }
  audioBar.classList.remove('has-content');
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  const allAudio = entry.resources.filter(resource => resource.type === '听力' && isAudioPath(resource.path || ''));
  const matched = setLabel ? allAudio.filter(resource => resource.name.includes(setLabel)) : [];
  const audioResources = matched.length
    ? matched
    : (setLabel ? (allAudio.length ? [allAudio[0]] : []) : allAudio);
  if (audioResources.length === 0) {
    return;
  }
  audioBar.classList.add('has-content');
  audioPlayer.src = wrapPath(audioResources[0].path);
  audioPlayer.load();
}

function renderYearShortcuts(currentEntryIndex, currentEntry, questionResource) {
  const container = document.getElementById('previewShortcuts');
  if (!container || !currentEntry) {
    return;
  }
  container.innerHTML = '';
  const currentLevel = currentEntry.level || 'cet6';
  const sameYearEntries = libraryData
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(item => item.entry.year === currentEntry.year && (item.entry.level || 'cet6') === currentLevel);
  let hasContent = false;
  sameYearEntries.forEach(({ entry, entryIndex }) => {
    const mappedResources = entry.resources
      .map((resource, resourceIndex) => ({ resource, resourceIndex }));
    const questionResources = mappedResources
      .filter(({ resource }) => resource.type === '真题' && resource.path.toLowerCase().endsWith('.pdf'));
    if (questionResources.length === 0) {
      return;
    }
    hasContent = true;
    const group = document.createElement('div');
    group.className = 'preview-shortcut-group';
    const title = document.createElement('div');
    title.className = 'preview-shortcut-group-title';
    title.textContent = formatShortcutGroupTitle(entry);
    const list = document.createElement('div');
    list.className = 'preview-shortcut-links';
    questionResources.forEach(({ resource, resourceIndex }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preview-shortcut-link';
      button.textContent = getSetLabel(resource.name) || `第${resourceIndex + 1}套`;
      if (entryIndex === currentEntryIndex && resource === questionResource) {
        button.classList.add('active');
      }
      button.addEventListener('click', () => {
        if (entryIndex === currentEntryIndex && resource === questionResource) {
          return;
        }
        const url = `preview.html?entry=${encodeURIComponent(entryIndex)}&resource=${encodeURIComponent(resourceIndex)}`;
        window.location.href = url;
      });
      list.appendChild(button);
    });
    group.appendChild(title);
    group.appendChild(list);
    container.appendChild(group);
  });
  container.style.display = hasContent ? 'flex' : 'none';
}

function loadPreview() {
  if (!Array.isArray(window.libraryData)) {
    showMessage('数据文件加载失败，请刷新页面重试。');
    return;
  }
  const params = getQueryParams();
  const entryIndex = Number.isFinite(params.entryIndex) ? params.entryIndex : NaN;
  const resourceIndex = Number.isFinite(params.resourceIndex) ? params.resourceIndex : NaN;
  if (Number.isNaN(entryIndex) || Number.isNaN(resourceIndex)) {
    showMessage('参数错误，请从首页重新点击套题按钮打开。');
    return;
  }
  const entry = libraryData[entryIndex];
  if (!entry) {
    showMessage('未找到对应年份资源。');
    return;
  }
  const entryLevel = entry.level || 'cet6';
  notesManager = new NotesManager(entryLevel);
  const selected = entry.resources[resourceIndex];
  if (!selected) {
    showMessage('未找到对应套题资源。');
    return;
  }
  const setLabel = getSetLabel(selected.name);
  const questionResource = selected.type === '真题' ? selected : getPdfResource(entry, setLabel, '真题');
  const parseResource = selected.type === '解析' ? selected : getPdfResource(entry, setLabel, '解析');
  if (!questionResource) {
    showMessage('该套题没有可预览的真题 PDF。');
    return;
  }
  const groupTitle = formatShortcutGroupTitle(entry);
  const levelLabel = (entry.level || 'cet6') === 'cet4' ? 'CET4' : 'CET6';
  document.getElementById('previewTitle').textContent = `${groupTitle}${levelLabel}真题·${setLabel || '听力资源'}`;
  document.getElementById('previewSubtitle').textContent = '左侧是真题原文，右侧展示解析，附带本套听力资源。';
  const mobile = isMobile();
  if (mobile) {
    document.querySelector('.preview-grid').style.display = 'none';
    document.getElementById('mobileTabs').style.display = '';
    initPdfJsWorker();
    renderPdfToCanvas('mobileExamCanvas', questionResource.path);
    if (parseResource) {
      renderPdfToCanvas('mobileParseCanvas', parseResource.path);
    } else {
      document.getElementById('mobileTabParse').innerHTML = '<p class="empty-state" style="padding:40px 20px;text-align:center;">本套暂无解析资源</p>';
    }
    const mobileAudioPlayer = document.getElementById('mobileAudioPlayer');
    if (mobileAudioPlayer) {
      const allAudio = entry.resources.filter(r => r.type === '听力' && isAudioPath(r.path || ''));
      const matched = setLabel ? allAudio.filter(r => r.name.includes(setLabel)) : [];
      const audioResources = matched.length ? matched : (setLabel ? (allAudio.length ? [allAudio[0]] : []) : allAudio);
      if (audioResources.length > 0) {
        mobileAudioPlayer.src = wrapPath(audioResources[0].path);
        mobileAudioPlayer.load();
        document.querySelector('#mobileTabAudio .empty-state').style.display = 'none';
      }
    }
    initMobileTabs();
    renderYearShortcuts(entryIndex, entry, questionResource);
    return;
  }
  document.getElementById('mainPdf').src = wrapPath(questionResource.path);
  const parseColumn = document.querySelector('.preview-column.preview-parse');
  const parsePanel = parseColumn ? parseColumn.querySelector('.preview-panel') : null;
  if (parseColumn) {
    parseColumn.classList.remove('no-parse');
  }
  if (parseResource && parsePanel) {
    parsePanel.style.display = '';
    document.getElementById('parsePdf').src = wrapPath(parseResource.path);
  } else if (parsePanel && parseColumn) {
    parsePanel.style.display = 'none';
    parseColumn.classList.add('no-parse');
  }
  document.body.classList.toggle('preview-no-parse', !parseResource);
  syncParseToggleState(Boolean(parseResource));
  renderYearShortcuts(entryIndex, entry, questionResource);
  renderAudioList(entry, setLabel);
}

function setSplitPercent(value, persist = true) {
  const clamped = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
  splitPercent = clamped;
  document.body.style.setProperty('--preview-main-width', `${clamped}%`);
  if (persist) {
    try { localStorage.setItem(SPLIT_STORAGE_KEY, String(clamped)); } catch (e) { /* quota exceeded */ }
  }
}

function initSplitResizer() {
  resizerElement = document.getElementById('previewResizer');
  const grid = document.querySelector('.preview-grid');
  if (!resizerElement || !grid) {
    return;
  }
  let storedSplit = NaN;
  try { storedSplit = Number(localStorage.getItem(SPLIT_STORAGE_KEY)); } catch (e) { /* private browsing */ }
  if (Number.isFinite(storedSplit)) {
    setSplitPercent(storedSplit, false);
  } else {
    setSplitPercent(DEFAULT_SPLIT, false);
  }

  const startDrag = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (document.body.classList.contains('preview-parse-hidden') || document.body.classList.contains('preview-no-parse')) {
      return;
    }
    activePointerId = event.pointerId;
    resizerElement.classList.add('dragging');
    resizerElement.setPointerCapture(activePointerId);
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    event.preventDefault();
  };

  const onDrag = event => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    const bounds = grid.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left;
    const ratio = (relativeX / bounds.width) * 100;
    setSplitPercent(ratio, false);
    event.preventDefault();
  };

  const stopDrag = event => {
    if (activePointerId !== event.pointerId) {
      return;
    }
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    resizerElement.classList.remove('dragging');
    resizerElement.releasePointerCapture(activePointerId);
    activePointerId = null;
    setSplitPercent(splitPercent, true);
  };

  resizerElement.addEventListener('pointerdown', startDrag);
  resizerElement.addEventListener('keydown', event => {
    if (document.body.classList.contains('preview-parse-hidden') || document.body.classList.contains('preview-no-parse')) {
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const delta = event.key === 'ArrowLeft' ? -2 : 2;
      setSplitPercent(splitPercent + delta);
      event.preventDefault();
    } else if (event.key === 'Home') {
      setSplitPercent(SPLIT_MIN);
      event.preventDefault();
    } else if (event.key === 'End') {
      setSplitPercent(SPLIT_MAX);
      event.preventDefault();
    }
  });
}

function initParseToggle() {
  parseToggleButton = document.getElementById('toggleParseBtn');
  if (!parseToggleButton) {
    return;
  }
  parseToggleButton.addEventListener('click', () => {
    if (parseToggleButton.style.display === 'none') {
      return;
    }
    const hidden = document.body.classList.toggle('preview-parse-hidden');
    try { localStorage.setItem(PARSE_VISIBILITY_KEY, hidden ? '1' : '0'); } catch (e) { /* quota exceeded */ }
    updateParseToggleLabel(hidden);
  });
}

function updateParseToggleLabel(forceHidden) {
  if (!parseToggleButton) {
    return;
  }
  const hidden = typeof forceHidden === 'boolean'
    ? forceHidden
    : document.body.classList.contains('preview-parse-hidden');
  parseToggleButton.textContent = hidden ? '显示解析' : '隐藏解析';
  parseToggleButton.setAttribute('aria-pressed', hidden ? 'true' : 'false');
  if (resizerElement) {
    if (hidden) {
      resizerElement.setAttribute('aria-hidden', 'true');
    } else {
      resizerElement.removeAttribute('aria-hidden');
    }
  }
}

function syncParseToggleState(hasParse) {
  if (!parseToggleButton) {
    return;
  }
  if (!hasParse) {
    document.body.classList.remove('preview-parse-hidden');
    parseToggleButton.style.display = 'none';
    parseToggleButton.setAttribute('aria-hidden', 'true');
    parseToggleButton.setAttribute('aria-pressed', 'false');
    if (resizerElement) {
      resizerElement.setAttribute('aria-hidden', 'true');
    }
    return;
  }
  parseToggleButton.style.display = '';
  parseToggleButton.removeAttribute('aria-hidden');
  if (resizerElement) {
    resizerElement.removeAttribute('aria-hidden');
  }
  let storedHidden = false;
  try { storedHidden = localStorage.getItem(PARSE_VISIBILITY_KEY) === '1'; } catch (e) { /* private browsing */ }
  document.body.classList.toggle('preview-parse-hidden', storedHidden);
  updateParseToggleLabel(storedHidden);
}

// ── Notes sidebar ─────────────────────────────────────────

function escapePreviewHtml(text) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function openNotesSidebar() {
  var sidebar = document.getElementById('notesSidebar');
  var overlay = document.getElementById('notesSidebarOverlay');
  if (sidebar) sidebar.classList.add('open');
  if (overlay) overlay.classList.add('visible');
  renderPreviewNotes();
}

function closeNotesSidebar() {
  var sidebar = document.getElementById('notesSidebar');
  var overlay = document.getElementById('notesSidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('visible');
}

function renderPreviewNotes() {
  if (!notesManager) return;
  var area = document.getElementById('previewNotesArea');
  if (area) area.value = notesManager.getQuickNote();
  renderPreviewEntries();
}

function renderPreviewEntries() {
  var list = document.getElementById('previewNotesEntries');
  if (!list || !notesManager) return;

  var entries = notesManager.getEntries().slice();
  entries.sort(function (a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  var recent = entries.slice(0, 5);

  if (recent.length === 0) {
    list.innerHTML = '<div class="notes-empty">暂无笔记</div>';
    return;
  }

  list.innerHTML = recent.map(function (entry) {
    return '<div class="note-entry-card' + (entry.pinned ? ' pinned' : '') + '">' +
      '<div class="note-entry-meta">' +
        '<span class="note-entry-category cat-' + entry.category + '">' + entry.category + '</span>' +
        '<span class="note-entry-time">' + NotesManager.formatTime(entry.updatedAt) + '</span>' +
      '</div>' +
      '<p class="note-entry-text">' + escapePreviewHtml(entry.text) + '</p>' +
    '</div>';
  }).join('');
}

function initNotesSidebar() {
  var toggleBtn = document.getElementById('toggleNotesSidebar');
  var closeBtn = document.getElementById('closeNotesSidebar');
  var overlay = document.getElementById('notesSidebarOverlay');
  var saveBtn = document.getElementById('previewSaveNote');
  var exportBtn = document.getElementById('previewExportBtn');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var sidebar = document.getElementById('notesSidebar');
      if (sidebar && sidebar.classList.contains('open')) {
        closeNotesSidebar();
      } else {
        openNotesSidebar();
      }
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeNotesSidebar);
  if (overlay) overlay.addEventListener('click', closeNotesSidebar);

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      if (!notesManager) return;
      var area = document.getElementById('previewNotesArea');
      if (area) {
        notesManager.saveQuickNote(area.value);
        saveBtn.textContent = '已保存';
        setTimeout(function () { saveBtn.textContent = '保存'; }, 1200);
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      if (notesManager) notesManager.exportToFile();
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('previewRefresh').addEventListener('click', () => window.location.reload());
  initSplitResizer();
  initParseToggle();
  initNotesSidebar();
  loadPreview();
});
