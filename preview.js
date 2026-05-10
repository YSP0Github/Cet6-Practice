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

function showMobilePdfFallback(iframeId, resource, label) {
  const iframe = document.getElementById(iframeId);
  if (!iframe || !resource) return;
  const panel = iframe.closest('.preview-panel');
  if (!panel) return;
  iframe.style.display = 'none';
  const fallback = document.createElement('div');
  fallback.className = 'mobile-pdf-fallback';
  fallback.innerHTML = `
    <div class="mobile-pdf-icon">📄</div>
    <p class="mobile-pdf-name">${resource.name}</p>
    <a class="button button-primary mobile-pdf-open" href="${wrapPath(resource.path)}" target="_blank" rel="noopener">${label || '打开 PDF'}</a>
  `;
  panel.appendChild(fallback);
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
  const sameYearEntries = libraryData
    .map((entry, entryIndex) => ({ entry, entryIndex }))
    .filter(item => item.entry.year === currentEntry.year);
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
  document.getElementById('previewTitle').textContent = `${groupTitle}CET6真题·${setLabel || '听力资源'}`;
  document.getElementById('previewSubtitle').textContent = '左侧是真题原文，右侧展示解析，附带本套听力资源。';
  const mobile = isMobile();
  if (mobile) {
    showMobilePdfFallback('mainPdf', questionResource, '打开真题 PDF');
  } else {
    document.getElementById('mainPdf').src = wrapPath(questionResource.path);
  }
  const parseColumn = document.querySelector('.preview-column.preview-parse');
  const parsePanel = parseColumn ? parseColumn.querySelector('.preview-panel') : null;
  if (parseColumn) {
    parseColumn.classList.remove('no-parse');
  }
  if (parseResource && parsePanel) {
    parsePanel.style.display = '';
    if (mobile) {
      showMobilePdfFallback('parsePdf', parseResource, '打开解析 PDF');
    } else {
      document.getElementById('parsePdf').src = wrapPath(parseResource.path);
    }
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

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('previewRefresh').addEventListener('click', () => window.location.reload());
  initSplitResizer();
  initParseToggle();
  loadPreview();
});
