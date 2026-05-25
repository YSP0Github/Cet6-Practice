(function () {
  'use strict';

  /* ── Constants ── */
  var STORAGE_PREFIX = 'cet_ac_draft_';
  var POS_KEY = 'answerCardPos';
  var SIZE_KEY = 'answerCardSize';
  var TIMER_KEY = 'answerCardTimer';
  var MIN_W = 380;
  var MIN_H = 400;
  var TOTAL_Q = 55;         // 客观题总数（不含作文翻译）
  var LISTEN_Q = 25;        // Q1-Q25
  var READ_CLOZE = 10;      // Q26-Q35
  var READ_MATCH = 10;      // Q36-Q45
  var READ_CARE = 10;       // Q46-Q55
  var LISTEN_FULL = 248.5;
  var READ_FULL = 248.5;

  var SECTIONS = [
    { title: '写作', icon: '✍️', start: -1, end: -1, type: 'essay' },
    { title: '听力 · Q1-Q25', icon: '🎧', start: 1, end: 25, type: 'abcd' },
    { title: '阅读 · 选词填空 Q26-Q35', icon: '📖', start: 26, end: 35, type: 'cloze' },
    { title: '阅读 · 长篇阅读 Q36-Q45', icon: '📖', start: 36, end: 45, type: 'match' },
    { title: '阅读 · 仔细阅读 Q46-Q55', icon: '📖', start: 46, end: 55, type: 'abcd2' },
    { title: '翻译', icon: '🌐', start: -2, end: -2, type: 'essay' }
  ];

  /* ── State ── */
  var currentExamKey = null;
  var currentLevel = 'cet6';
  var userAnswers = {};
  var gradedState = null;
  var timerElapsed = 0;
  var timerStart = null;
  var timerInterval = null;
  var panel = null;
  var initialized = false;

  /* ── Helpers ── */
  function $(id) { return document.getElementById(id); }

  function getExamKey(entry, resource) {
    if (!resource || !resource.name) return null;
    var stem = resource.name.replace(/\.(pdf|mp3)$/i, '').trim();
    var level = (entry && entry.level) || 'cet6';
    if (level === 'cet4') return 'cet4/' + stem;
    return stem;
  }

  function formatTime(seconds) {
    var m = String(Math.floor(seconds / 60)).padStart(2, '0');
    var s = String(seconds % 60).padStart(2, '0');
    return m + ':' + s;
  }

  function showToast(msg) {
    var existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'toast-notification';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('visible'); });
    setTimeout(function () {
      el.classList.remove('visible');
      setTimeout(function () { el.remove(); }, 300);
    }, 3000);
  }

  /* ── Storage ── */
  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_PREFIX + currentExamKey, JSON.stringify({
        answers: userAnswers,
        elapsed: timerElapsed,
        ts: Date.now()
      }));
    } catch (e) { /* quota */ }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + currentExamKey);
      if (raw) {
        var data = JSON.parse(raw);
        userAnswers = data.answers || {};
        timerElapsed = data.elapsed || 0;
      }
    } catch (e) { /* corrupt */ }
  }

  function savePosition() {
    if (!panel) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        left: panel.style.left,
        top: panel.style.top
      }));
      localStorage.setItem(SIZE_KEY, JSON.stringify({
        w: panel.style.width,
        h: panel.style.height
      }));
    } catch (e) { /* quota */ }
  }

  function restorePosition() {
    try {
      var pos = JSON.parse(localStorage.getItem(POS_KEY));
      var size = JSON.parse(localStorage.getItem(SIZE_KEY));
      if (size && size.w && size.h) {
        var w = Math.min(parseInt(size.w, 10) || 540, window.innerWidth * 0.95);
        var h = Math.min(parseInt(size.h, 10) || 500, window.innerHeight * 0.9);
        panel.style.width = w + 'px';
        panel.style.height = h + 'px';
      }
      if (pos && pos.left && pos.top) {
        var pw = panel.offsetWidth || 540;
        var ph = panel.offsetHeight || 500;
        var x = parseInt(pos.left, 10) || 0;
        var y = parseInt(pos.top, 10) || 0;
        x = Math.max(0, Math.min(window.innerWidth - pw, x));
        y = Math.max(0, Math.min(window.innerHeight - ph, y));
        panel.style.transform = 'none';
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.classList.add('dragged');
      }
    } catch (e) { /* corrupt */ }
  }

  /* ── Timer ── */
  function startTimer() {
    if (timerInterval) return;
    timerStart = Date.now() - timerElapsed * 1000;
    timerInterval = setInterval(function () {
      timerElapsed = Math.floor((Date.now() - timerStart) / 1000);
      var el = $('answerCardTimer');
      if (el) el.textContent = formatTime(timerElapsed);
    }, 1000);
    var el = $('answerCardTimer');
    if (el) el.textContent = formatTime(timerElapsed);
  }

  function pauseTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /* ── Progress ── */
  function updateProgress() {
    var objCount = 0;
    for (var i = 1; i <= TOTAL_Q; i++) {
      if (userAnswers[String(i)]) objCount++;
    }
    var essayDone = userAnswers['_essay'] ? 1 : 0;
    var transDone = userAnswers['_translation'] ? 1 : 0;
    var total = TOTAL_Q + 2;
    var count = objCount + essayDone + transDone;
    var pct = Math.round(count / total * 100);
    var fill = $('answerCardProgressFill');
    var text = $('answerCardProgressText');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = count + '/' + total + ' 已作答';
  }

  /* ── Render grid ── */
  function renderAnswerGrid() {
    var body = $('answerCardBody');
    if (!body) return;
    body.innerHTML = '';

    // Result summary (if graded)
    if (gradedState) {
      body.innerHTML = buildResultSummary();
    }

    // Answer data notice
    var akData = window.answerKeyData;
    var akEntry = akData && akData[currentExamKey];
    if (akEntry && akEntry.note) {
      var hasAnswers = akEntry.answers && Object.keys(akEntry.answers).length > 0;
      var notice = document.createElement('div');
      notice.className = 'ac-data-notice' + (hasAnswers ? '' : ' ac-data-notice-warn');
      notice.textContent = akEntry.note;
      body.insertBefore(notice, body.firstChild);
    }

    SECTIONS.forEach(function (sec) {
      var wrap = document.createElement('div');
      wrap.className = 'ac-section';
      var title = document.createElement('div');
      title.className = 'ac-section-title';
      title.textContent = sec.icon + ' ' + sec.title;
      wrap.appendChild(title);

      if (sec.type === 'essay') {
        wrap.appendChild(buildEssayBlock(sec));
        body.appendChild(wrap);
        return;
      }

      if (sec.type === 'abcd' || sec.type === 'abcd2') {
        // 听力(1-25)和仔细阅读(46-55)：左右两列
        var twoCol = document.createElement('div');
        twoCol.className = 'ac-two-col';
        var count = sec.end - sec.start + 1;
        var mid = sec.start + Math.ceil(count / 2); // 听力14, 仔细阅读51
        [sec.start, mid].forEach(function (colStart) {
          var colEnd = (colStart === sec.start) ? mid - 1 : sec.end;
          var grid = document.createElement('div');
          grid.className = 'ac-question-grid';
          for (var q = colStart; q <= colEnd; q++) {
            grid.appendChild(buildQuestionRow(q, ['A', 'B', 'C', 'D']));
          }
          twoCol.appendChild(grid);
        });
        wrap.appendChild(twoCol);
        body.appendChild(wrap);
        return;
      }

      var grid = document.createElement('div');
      grid.className = 'ac-question-grid';

      for (var q = sec.start; q <= sec.end; q++) {
        var qs = String(q);
        var row = document.createElement('div');
        row.className = 'ac-question';
        row.dataset.q = qs;
        if (!userAnswers[qs] && !gradedState) row.classList.add('unanswered');

        var num = document.createElement('span');
        num.className = 'ac-qnum';
        num.textContent = qs;
        row.appendChild(num);

        if (sec.type === 'match') {
          var letters = [];
          for (var c = 65; c <= 79; c++) letters.push(String.fromCharCode(c)); // A-O
          row.appendChild(buildAbcdOptions(qs, letters, true));
        } else if (sec.type === 'cloze') {
          var clozeLetters = [];
          for (var c2 = 65; c2 <= 79; c2++) clozeLetters.push(String.fromCharCode(c2)); // A-O
          row.appendChild(buildAbcdOptions(qs, clozeLetters, true));
        }

        grid.appendChild(row);
      }

      wrap.appendChild(grid);
      body.appendChild(wrap);
    });

    // Apply graded state
    if (gradedState) applyGradingHighlights();
  }

  function buildAbcdOptions(qs, letters, wide) {
    var wrap = document.createElement('div');
    var cls = 'ac-options';
    if (wide) cls += ' ac-options-wide';
    wrap.className = cls;
    letters.forEach(function (v) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-option';
      btn.dataset.q = qs;
      btn.dataset.v = v;
      btn.textContent = v;
      if (userAnswers[qs] === v) btn.classList.add('selected');
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function buildQuestionRow(q, letters) {
    var qs = String(q);
    var row = document.createElement('div');
    row.className = 'ac-question';
    row.dataset.q = qs;
    if (!userAnswers[qs] && !gradedState) row.classList.add('unanswered');
    var num = document.createElement('span');
    num.className = 'ac-qnum';
    num.textContent = qs;
    row.appendChild(num);
    row.appendChild(buildAbcdOptions(qs, letters));
    return row;
  }

  function buildEssayBlock(sec) {
    var key = sec.start === -1 ? '_essay' : '_translation';
    var wrap = document.createElement('div');
    wrap.className = 'ac-essay-block';

    var textarea = document.createElement('textarea');
    textarea.className = 'ac-essay-textarea';
    textarea.dataset.key = key;
    textarea.placeholder = sec.start === -1 ? '在此输入作文...' : '在此输入翻译...';
    textarea.rows = 6;
    if (userAnswers[key]) textarea.value = userAnswers[key];

    var footer = document.createElement('div');
    footer.className = 'ac-essay-footer';

    var count = document.createElement('span');
    count.className = 'ac-essay-count';
    var textLen = (userAnswers[key] || '').length;
    count.textContent = textLen + ' 字';

    var scoreWrap = document.createElement('div');
    scoreWrap.className = 'ac-essay-score-wrap';

    var scoreLabel = document.createElement('span');
    scoreLabel.className = 'ac-essay-score-label';
    scoreLabel.textContent = '自评得分：';

    var scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.className = 'ac-essay-score-input';
    scoreInput.dataset.key = key + '_score';
    scoreInput.min = '0';
    scoreInput.max = sec.start === -1 ? '106.5' : '106.5';
    scoreInput.step = '0.5';
    scoreInput.placeholder = '0-' + (sec.start === -1 ? '106.5' : '106.5');
    if (userAnswers[key + '_score']) scoreInput.value = userAnswers[key + '_score'];

    var scoreUnit = document.createElement('span');
    scoreUnit.className = 'ac-essay-score-unit';
    scoreUnit.textContent = '分';

    scoreWrap.appendChild(scoreLabel);
    scoreWrap.appendChild(scoreInput);
    scoreWrap.appendChild(scoreUnit);
    footer.appendChild(count);
    footer.appendChild(scoreWrap);

    wrap.appendChild(textarea);
    wrap.appendChild(footer);

    // Event listeners
    textarea.addEventListener('input', function () {
      userAnswers[key] = textarea.value;
      count.textContent = textarea.value.length + ' 字';
      saveDraft();
    });
    scoreInput.addEventListener('input', function () {
      if (scoreInput.value) {
        userAnswers[key + '_score'] = scoreInput.value;
      } else {
        delete userAnswers[key + '_score'];
      }
      saveDraft();
    });

    return wrap;
  }

  function buildResultSummary() {
    var s = gradedState;
    var total = s.listenCorrect + s.readCorrect;
    var objScore = Math.round((s.listenScore + s.readScore) * 10) / 10;
    var essayScore = parseFloat(userAnswers['_essay_score']) || 0;
    var transScore = parseFloat(userAnswers['_translation_score']) || 0;
    var allScore = Math.round((objScore + essayScore + transScore) * 10) / 10;
    var html = '<div class="ac-result-summary">' +
      '<div class="ac-result-total">总分</div>' +
      '<div class="ac-result-score">' + allScore + '<span class="ac-result-max"> / 710</span></div>' +
      '<div class="ac-breakdown">' +
        '<div class="ac-breakdown-item">' +
          '<span class="ac-breakdown-label">听力</span>' +
          '<span class="ac-breakdown-value">' + s.listenCorrect + '/' + LISTEN_Q + ' (' + s.listenScore + '分)</span>' +
        '</div>' +
        '<div class="ac-breakdown-item">' +
          '<span class="ac-breakdown-label">阅读</span>' +
          '<span class="ac-breakdown-value">' + s.readCorrect + '/' + (READ_CLOZE + READ_MATCH + READ_CARE) + ' (' + s.readScore + '分)</span>' +
        '</div>' +
        '<div class="ac-breakdown-item">' +
          '<span class="ac-breakdown-label">写作</span>' +
          '<span class="ac-breakdown-value">' + (essayScore > 0 ? essayScore + '分' : '未评') + '</span>' +
        '</div>' +
        '<div class="ac-breakdown-item">' +
          '<span class="ac-breakdown-label">翻译</span>' +
          '<span class="ac-breakdown-value">' + (transScore > 0 ? transScore + '分' : '未评') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="ac-result-time">用时 ' + formatTime(timerElapsed) + '</div>' +
    '</div>';
    return html;
  }

  function applyGradingHighlights() {
    if (!gradedState || !gradedState.answerKey) return;
    var ak = gradedState.answerKey;
    var body = $('answerCardBody');
    if (!body) return;

    // ABCD / match options
    body.querySelectorAll('.ac-option').forEach(function (btn) {
      var q = btn.dataset.q;
      var v = btn.dataset.v;
      var correct = ak[q];
      var chosen = userAnswers[q];
      if (!correct) return;
      if (v === correct && v === chosen) {
        btn.classList.add('correct');
      } else if (v === chosen && v !== correct) {
        btn.classList.add('wrong');
      } else if (v === correct) {
        btn.classList.add('correct-answer');
      }
    });

  }

  /* ── Submit & grade ── */
  function submitAndGrade() {
    var akData = window.answerKeyData;
    if (!akData || !akData[currentExamKey]) {
      showToast('本套真题暂无答案数据，请自行核对');
      return;
    }
    var entry = akData[currentExamKey];
    var ak = entry.answers;
    if (!ak || Object.keys(ak).length === 0) {
      var note = entry.note || '暂无答案，请自行核对';
      showToast(note);
      return;
    }

    var unanswered = 0;
    for (var i = 1; i <= TOTAL_Q; i++) {
      if (!userAnswers[String(i)]) unanswered++;
    }

    if (unanswered > 0) {
      if (!confirm('还有 ' + unanswered + ' 题未作答，确定交卷吗？')) return;
    }

    pauseTimer();

    var listenCorrect = 0;
    for (var q = 1; q <= LISTEN_Q; q++) {
      var qs = String(q);
      if (userAnswers[qs] && userAnswers[qs] === ak[qs]) listenCorrect++;
    }

    var readCorrect = 0;
    // Cloze + Match + Careful: strict comparison
    for (var q2 = 26; q2 <= 55; q2++) {
      var qs2 = String(q2);
      if (userAnswers[qs2] && userAnswers[qs2] === ak[qs2]) readCorrect++;
    }

    var listenScore = Math.round(listenCorrect / LISTEN_Q * LISTEN_FULL * 10) / 10;
    var readScore = Math.round(readCorrect / (READ_CLOZE + READ_MATCH + READ_CARE) * READ_FULL * 10) / 10;

    gradedState = {
      answerKey: ak,
      listenCorrect: listenCorrect,
      readCorrect: readCorrect,
      listenScore: listenScore,
      readScore: readScore
    };

    renderAnswerGrid();
    updateProgress();
  }

  /* ── Reset ── */
  function resetAnswers() {
    if (!confirm('确定要清空所有答案重新作答吗？')) return;
    userAnswers = {};
    gradedState = null;
    timerElapsed = 0;
    timerStart = Date.now();
    saveDraft();
    renderAnswerGrid();
    updateProgress();
    var el = $('answerCardTimer');
    if (el) el.textContent = '00:00';
  }

  /* ── Open / Close ── */
  function openAnswerCard() {
    if (!panel) panel = $('answerCardPanel');
    if (!panel) return;
    panel.style.display = 'flex';
    restorePosition();
    renderAnswerGrid();
    updateProgress();
    startTimer();
    // Set exam tag
    var tag = $('answerCardExamTag');
    if (tag) {
      tag.textContent = currentExamKey ? currentExamKey.replace('_', ' ') : '';
      tag.style.display = currentExamKey ? '' : 'none';
    }
  }

  function closeAnswerCard() {
    if (!panel) return;
    panel.style.display = 'none';
    panel.classList.remove('transparent');
    pauseTimer();
    saveDraft();
    if (onCloseCallback) onCloseCallback();
  }

  var onCloseCallback = null;

  /* ── Event delegation ── */
  function onBodyClick(e) {
    var btn = e.target.closest('.ac-option');
    if (!btn || gradedState) return;
    var q = btn.dataset.q;
    var v = btn.dataset.v;
    var opts = btn.closest('.ac-options');
    if (opts) {
      opts.querySelectorAll('.ac-option').forEach(function (b) { b.classList.remove('selected'); });
    }
    btn.classList.add('selected');
    userAnswers[q] = v;
    var row = btn.closest('.ac-question');
    if (row) row.classList.remove('unanswered');
    saveDraft();
    updateProgress();
  }

  /* ── Drag (Pointer Events) ── */
  function initDrag() {
    var header = $('answerCardHeader');
    if (!header || !panel) return;
    var offX = 0, offY = 0, pw = 0, ph = 0;

    header.style.touchAction = 'none';

    header.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.answer-card-close')) return;
      if (e.target.closest('.answer-card-timer')) return;
      if (e.target.closest('.ac-toggle-vis')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var rect = panel.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
      pw = panel.offsetWidth;
      ph = panel.offsetHeight;
      header.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
      if (!panel.classList.contains('dragged')) {
        panel.style.transform = 'none';
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.classList.add('dragged');
      }
      header.addEventListener('pointermove', onMove);
      header.addEventListener('pointerup', onUp);
      header.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });

    function onMove(e) {
      var x = Math.max(0, Math.min(window.innerWidth - pw, e.clientX - offX));
      var y = Math.max(0, Math.min(window.innerHeight - ph, e.clientY - offY));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      e.preventDefault();
    }

    function onUp(e) {
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onUp);
      header.removeEventListener('pointercancel', onUp);
      header.releasePointerCapture(e.pointerId);
      panel.classList.remove('dragging');
      savePosition();
    }
  }

  /* ── Resize (Pointer Events) ── */
  function initResize() {
    var handle = $('answerCardResizeHandle');
    if (!handle || !panel) return;
    var resizing = false;
    var startW, startH, startX, startY;

    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var rect = panel.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      startX = e.clientX;
      startY = e.clientY;
      resizing = true;
      handle.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });

    function onMove(e) {
      if (!resizing) return;
      var w = Math.max(MIN_W, startW + (e.clientX - startX));
      var h = Math.max(MIN_H, startH + (e.clientY - startY));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
      e.preventDefault();
    }

    function onUp(e) {
      if (!resizing) return;
      resizing = false;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.releasePointerCapture(e.pointerId);
      panel.classList.remove('dragging');
      savePosition();
    }
  }

  /* ── Keyboard ── */
  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel && panel.style.display !== 'none') {
        closeAnswerCard();
      }
    });
  }

  /* ── Init ── */
  function init() {
    if (initialized) return;
    initialized = true;
    panel = $('answerCardPanel');
    if (!panel) return;

    // Get exam context from URL params
    var params = new URLSearchParams(window.location.search);
    var entryIndex = Number(params.get('entry'));
    var resourceIndex = Number(params.get('resource'));

    if (Array.isArray(window.libraryData) && Number.isFinite(entryIndex) && Number.isFinite(resourceIndex)) {
      var entry = window.libraryData[entryIndex];
      if (entry) {
        currentLevel = entry.level || 'cet6';
        var resource = entry.resources[resourceIndex];
        if (resource) {
          currentExamKey = getExamKey(entry, resource);
        }
      }
    }

    // Load draft
    if (currentExamKey) {
      loadDraft();
    }

    // Event listeners
    var toggleBtn = $('toggleAnswerCard');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (panel.style.display === 'none') {
          openAnswerCard();
        } else {
          closeAnswerCard();
        }
      });
    }

    var closeBtn = $('closeAnswerCard');
    if (closeBtn) closeBtn.addEventListener('click', closeAnswerCard);

    var submitBtn = $('answerCardSubmit');
    if (submitBtn) submitBtn.addEventListener('click', submitAndGrade);

    var resetBtn = $('answerCardReset');
    if (resetBtn) resetBtn.addEventListener('click', resetAnswers);

    var body = $('answerCardBody');
    if (body) {
      body.addEventListener('click', onBodyClick);
    }

    // Mobile: toggle button in header, left of timer
    if (!window.matchMedia('(hover: hover)').matches) {
      var headerActions = document.querySelector('.answer-card-header-actions');
      if (headerActions) {
        var toggleVis = document.createElement('button');
        toggleVis.type = 'button';
        toggleVis.className = 'ac-toggle-vis';
        toggleVis.textContent = '👁';
        toggleVis.title = '切换透明';
        headerActions.insertBefore(toggleVis, headerActions.firstChild);

        toggleVis.addEventListener('click', function (e) {
          e.stopPropagation();
          panel.classList.toggle('transparent');
        });
      }

      onCloseCallback = function () {
        panel.classList.remove('transparent');
      };
    }

    initDrag();
    initResize();
    initKeyboard();
  }

  /* ── Public API ── */
  window.AnswerCard = {
    init: init,
    open: openAnswerCard,
    close: closeAnswerCard
  };
})();
