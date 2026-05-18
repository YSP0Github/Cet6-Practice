(function () {
  'use strict';

  var STORAGE_SUFFIX = '_NotesV2';
  var OLD_NOTES_SUFFIX = '_Notes';
  var OLD_PLAN_IDS = ['plan-1', 'plan-2', 'plan-3'];
  var CATEGORIES = ['听力', '阅读', '写作', '翻译', '词汇', '综合'];
  var IDB_DB = 'cet6-notes-fs';
  var IDB_STORE = 'handles';
  var IDB_KEY = 'dirHandle';
  var IDB_META_KEY = 'dirName';

  var DEFAULT_DAILY_TASKS = [
    { id: 'dt-1', label: '完成一套真题练习' },
    { id: 'dt-2', label: '听力至少听两遍' },
    { id: 'dt-3', label: '记录一个错题点' }
  ];

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dateKeyFromDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ── IndexedDB helpers for directory handle persistence ──

  function openIDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_DB, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var store = tx.objectStore(IDB_STORE);
        var req = store.get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(key, value) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var req = store.put(value, key);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbDelete(key) {
    return openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var req = store.delete(key);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ── Data migration ────────────────────────────────────────

  function generateId() {
    var rand = Math.random().toString(36).substring(2, 5);
    return 'n_' + Date.now() + '_' + rand;
  }

  function migrateNotes(level) {
    var newKey = level + STORAGE_SUFFIX;
    if (localStorage.getItem(newKey)) return;

    var oldText = localStorage.getItem(level + OLD_NOTES_SUFFIX) || '';
    var planChecks = {};
    OLD_PLAN_IDS.forEach(function (id) {
      planChecks[id] = localStorage.getItem(id) === 'true';
    });

    var hasContent = oldText || Object.values(planChecks).some(function (v) { return v; });
    if (hasContent) {
      var data = {
        version: 2,
        entries: [],
        quickNote: oldText,
        planChecks: planChecks,
        dailyCheckins: {},
        dailyTasks: DEFAULT_DAILY_TASKS.map(function (t) { return { id: t.id, label: t.label }; })
      };
      try { localStorage.setItem(newKey, JSON.stringify(data)); } catch (e) { /* quota */ }
    }

    localStorage.removeItem(level + OLD_NOTES_SUFFIX);
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var month = d.getMonth() + 1;
    var day = d.getDate();
    var hours = String(d.getHours()).padStart(2, '0');
    var minutes = String(d.getMinutes()).padStart(2, '0');
    return month + '月' + day + '日 ' + hours + ':' + minutes;
  }

  // ── Exam ID helpers ──────────────────────────────────────

  function generateExamId(year, month, level, setLabel) {
    var y = String(year).slice(-2);
    var m = month ? String(month).padStart(2, '0') : '00';
    var lv = (level || 'cet6').replace('cet', '');
    var setNum = '1';
    if (setLabel) {
      var setMatch = setLabel.match(/第(\d+)套/);
      if (setMatch) setNum = setMatch[1];
    }
    return y + '-' + m + '-' + lv + '-' + setNum;
  }

  // ── Constructor ──────────────────────────────────────────

  function NotesManager(level) {
    this.level = level;
    this.data = null;
    this._dirHandle = null;
    this._dirName = null;
    this._saveTimer = null;
    this._currentExamId = null;
    migrateNotes(level);
    this._load();
    this._restoreDirHandle();
  }

  // ── Internal ─────────────────────────────────────────────

  NotesManager.prototype._storageKey = function () {
    return this.level + STORAGE_SUFFIX;
  };

  NotesManager.prototype._load = function () {
    try {
      var raw = localStorage.getItem(this._storageKey());
      if (raw) this.data = JSON.parse(raw);
    } catch (e) { /* corrupt */ }
    if (!this.data || !this.data.version) {
      this.data = {
        version: 2,
        entries: [],
        quickNote: '',
        planChecks: {},
        dailyCheckins: {},
        dailyTasks: DEFAULT_DAILY_TASKS.map(function (t) { return { id: t.id, label: t.label }; })
      };
    }
    if (!this.data.dailyCheckins) this.data.dailyCheckins = {};
    if (!this.data.dailyTasks) {
      this.data.dailyTasks = DEFAULT_DAILY_TASKS.map(function (t) { return { id: t.id, label: t.label }; });
    }
  };

  NotesManager.prototype._save = function () {
    try { localStorage.setItem(this._storageKey(), JSON.stringify(this.data)); } catch (e) { /* quota */ }
    this._scheduleAutoSave();
  };

  // ── Auto-save to folder (debounced) ──────────────────────

  NotesManager.prototype._scheduleAutoSave = function () {
    var self = this;
    if (self._saveTimer) clearTimeout(self._saveTimer);
    self._saveTimer = setTimeout(function () {
      self._saveToFolder();
    }, 800);
  };

  NotesManager.prototype._saveToFolder = function () {
    if (!this._dirHandle) return;
    var self = this;
    var fileName = 'cet-notes-' + this.level + '.json';
    var exportData = {
      app: 'CET6-Practice',
      exportedAt: new Date().toISOString(),
      level: this.level,
      data: this.data
    };
    var json = JSON.stringify(exportData, null, 2);

    this._dirHandle.getFileHandle(fileName, { create: true })
      .then(function (fileHandle) { return fileHandle.createWritable(); })
      .then(function (writable) { return writable.write(json).then(function () { return writable.close(); }); })
      .catch(function (err) {
        console.warn('自动保存到文件夹失败:', err.message);
      });
  };

  // ── Restore directory handle from IndexedDB ──────────────

  NotesManager.prototype._restoreDirHandle = function () {
    var self = this;
    if (!('showDirectoryPicker' in window)) return;
    idbGet(IDB_KEY).then(function (handle) {
      if (handle) {
        // Verify permission is still valid
        handle.requestPermission({ mode: 'readwrite' }).then(function (perm) {
          if (perm === 'granted') {
            self._dirHandle = handle;
            return idbGet(IDB_META_KEY);
          } else {
            self._dirHandle = null;
            self._dirName = null;
            idbDelete(IDB_KEY);
            idbDelete(IDB_META_KEY);
            return null;
          }
        }).then(function (name) {
          self._dirName = name || '已选择的文件夹';
          if (typeof self._onStorageChange === 'function') self._onStorageChange();
        }).catch(function () {
          self._dirHandle = null;
        });
      }
    }).catch(function () { /* IDB not available */ });
  };

  // ── Folder picker ─────────────────────────────────────────

  NotesManager.prototype.chooseFolder = function () {
    if (!('showDirectoryPicker' in window)) {
      return Promise.reject(new Error('当前浏览器不支持文件夹选择，请使用 Edge 或 Chrome。'));
    }
    var self = this;
    return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dirHandle) {
      var oldHandle = self._dirHandle;
      self._dirHandle = dirHandle;
      self._dirName = dirHandle.name;
      // Persist handle to IndexedDB
      return Promise.all([
        idbPut(IDB_KEY, dirHandle),
        idbPut(IDB_META_KEY, dirHandle.name)
      ]).then(function () {
        // If there was an old folder, copy files to new folder
        if (oldHandle) {
          return self._copyFilesToNewFolder(oldHandle, dirHandle);
        }
      }).then(function () {
        // Save current data to new folder immediately
        self._saveToFolder();
        if (typeof self._onStorageChange === 'function') self._onStorageChange();
      });
    });
  };

  NotesManager.prototype._copyFilesToNewFolder = function (oldHandle, newHandle) {
    var self = this;
    // Copy both cet4 and cet6 notes files
    var fileNames = ['cet-notes-cet4.json', 'cet-notes-cet6.json'];
    var copyNext = function (index) {
      if (index >= fileNames.length) return Promise.resolve();
      return oldHandle.getFileHandle(fileNames[index]).then(function (fh) {
        return fh.getFile().then(function (file) {
          return file.text().then(function (text) {
            return newHandle.getFileHandle(fileNames[index], { create: true }).then(function (newFh) {
              return newFh.createWritable().then(function (w) {
                return w.write(text).then(function () { return w.close(); });
              });
            });
          });
        });
      }).catch(function () {
        // File doesn't exist in old folder, skip
        return copyNext(index + 1);
      }).then(function () {
        return copyNext(index + 1);
      });
    };
    return copyNext(0);
  };

  NotesManager.prototype.resetStorage = function () {
    var self = this;
    self._dirHandle = null;
    self._dirName = null;
    return Promise.all([
      idbDelete(IDB_KEY),
      idbDelete(IDB_META_KEY)
    ]).then(function () {
      if (typeof self._onStorageChange === 'function') self._onStorageChange();
    });
  };

  NotesManager.prototype.getStorageInfo = function () {
    return {
      hasFolder: !!this._dirHandle,
      folderName: this._dirName || null,
      supported: !!('showDirectoryPicker' in window)
    };
  };

  // ── Data access ──────────────────────────────────────────

  NotesManager.prototype.getData = function () { return this.data; };
  NotesManager.prototype.getEntries = function () { return this.data.entries; };
  NotesManager.prototype.getQuickNote = function () { return this.data.quickNote || ''; };
  NotesManager.prototype.getPlanChecks = function () { return this.data.planChecks || {}; };

  // ── Exam context ─────────────────────────────────────────

  NotesManager.prototype.setCurrentExam = function (examId) {
    this._currentExamId = examId || null;
  };

  NotesManager.prototype.getCurrentExam = function () {
    return this._currentExamId;
  };

  // ── CRUD for entries ─────────────────────────────────────

  NotesManager.prototype.addEntry = function (text, category, tags) {
    if (!text || !text.trim()) return null;
    var entry = {
      id: generateId(),
      text: text.trim(),
      category: CATEGORIES.indexOf(category) >= 0 ? category : '综合',
      tags: Array.isArray(tags) ? tags.filter(function (t) { return t; }) : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      examId: this._currentExamId || ''
    };
    this.data.entries.unshift(entry);
    this._save();
    return entry;
  };

  NotesManager.prototype.updateEntry = function (id, changes) {
    var entry = this.data.entries.find(function (e) { return e.id === id; });
    if (!entry) return;
    if (changes.text !== undefined) entry.text = changes.text;
    if (changes.category !== undefined && CATEGORIES.indexOf(changes.category) >= 0) entry.category = changes.category;
    if (changes.tags !== undefined) entry.tags = changes.tags.filter(function (t) { return t; });
    entry.updatedAt = Date.now();
    this._save();
  };

  NotesManager.prototype.deleteEntry = function (id) {
    this.data.entries = this.data.entries.filter(function (e) { return e.id !== id; });
    this._save();
  };

  NotesManager.prototype.togglePin = function (id) {
    var entry = this.data.entries.find(function (e) { return e.id === id; });
    if (entry) {
      entry.pinned = !entry.pinned;
      entry.updatedAt = Date.now();
      this._save();
    }
  };

  // ── Quick note ───────────────────────────────────────────

  NotesManager.prototype.saveQuickNote = function (text) {
    this.data.quickNote = text;
    this._save();
  };

  NotesManager.prototype.clearQuickNote = function () {
    this.data.quickNote = '';
    this._save();
  };

  // ── Daily check-in ─────────────────────────────────────

  NotesManager.prototype.getDailyTasks = function () {
    return this.data.dailyTasks || DEFAULT_DAILY_TASKS.map(function (t) { return { id: t.id, label: t.label }; });
  };

  NotesManager.prototype._ensureDay = function (key) {
    if (!this.data.dailyCheckins[key]) {
      var tasks = this.getDailyTasks().map(function (t) {
        return { id: t.id, label: t.label, checked: false };
      });
      this.data.dailyCheckins[key] = { tasks: tasks };
    }
    return this.data.dailyCheckins[key];
  };

  NotesManager.prototype.getTodayCheckins = function () {
    return this._ensureDay(todayKey());
  };

  NotesManager.prototype.setTaskCheck = function (taskId, checked) {
    var day = this.getTodayCheckins();
    var task = day.tasks.find(function (t) { return t.id === taskId; });
    if (task) {
      task.checked = !!checked;
      this._save();
    }
  };

  NotesManager.prototype.addDailyTask = function (label) {
    if (!label || !label.trim()) return null;
    var id = 'dt-' + Date.now();
    this.data.dailyTasks.push({ id: id, label: label.trim() });
    this._save();
    return { id: id, label: label.trim() };
  };

  NotesManager.prototype.removeDailyTask = function (taskId) {
    this.data.dailyTasks = this.data.dailyTasks.filter(function (t) { return t.id !== taskId; });
    var key = todayKey();
    if (this.data.dailyCheckins[key]) {
      this.data.dailyCheckins[key].tasks = this.data.dailyCheckins[key].tasks.filter(function (t) {
        return t.id !== taskId;
      });
    }
    this._save();
  };

  NotesManager.prototype.getStreak = function () {
    var count = 0;
    var d = new Date();
    while (true) {
      var key = dateKeyFromDate(d);
      var day = this.data.dailyCheckins[key];
      if (!day || !day.tasks || day.tasks.length === 0) break;
      var allDone = day.tasks.every(function (t) { return t.checked; });
      if (!allDone) break;
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  };

  NotesManager.prototype.getHistory = function (days) {
    var result = [];
    var d = new Date();
    for (var i = 0; i < (days || 7); i++) {
      var key = dateKeyFromDate(d);
      var day = this.data.dailyCheckins[key];
      var total = 0;
      var done = 0;
      if (day && day.tasks) {
        total = day.tasks.length;
        done = day.tasks.filter(function (t) { return t.checked; }).length;
      }
      result.push({
        date: key,
        label: (d.getMonth() + 1) + '/' + d.getDate(),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        total: total,
        done: done,
        allDone: total > 0 && done === total
      });
      d.setDate(d.getDate() - 1);
    }
    return result;
  };

  NotesManager.prototype.getCompletionStats = function () {
    var keys = Object.keys(this.data.dailyCheckins);
    if (keys.length === 0) return { totalDays: 0, completedDays: 0, rate: 0 };
    var completed = 0;
    keys.forEach(function (key) {
      var day = this.data.dailyCheckins[key];
      if (day && day.tasks && day.tasks.length > 0) {
        var allDone = day.tasks.every(function (t) { return t.checked; });
        if (allDone) completed++;
      }
    }.bind(this));
    return { totalDays: keys.length, completedDays: completed, rate: Math.round(completed / keys.length * 100) };
  };

  // ── Search / filter ──────────────────────────────────────

  NotesManager.prototype.searchEntries = function (query, category, examId) {
    var q = (query || '').trim().toLowerCase();
    return this.data.entries.filter(function (e) {
      if (category && category !== 'all' && e.category !== category) return false;
      if (examId && e.examId && e.examId !== examId) return false;
      if (!q) return true;
      var inText = e.text.toLowerCase().indexOf(q) >= 0;
      var inTags = e.tags.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
      var inExam = e.examId && e.examId.toLowerCase().indexOf(q) >= 0;
      return inText || inTags || inExam;
    });
  };

  // ── Level switching ──────────────────────────────────────

  NotesManager.prototype.switchLevel = function (newLevel) {
    this.level = newLevel;
    migrateNotes(newLevel);
    this._load();
  };

  // ── Export / Import ──────────────────────────────────────

  NotesManager.prototype.exportToFile = function () {
    var exportData = {
      app: 'CET6-Practice',
      exportedAt: new Date().toISOString(),
      level: this.level,
      data: this.data
    };
    var json = JSON.stringify(exportData, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'cet-notes-' + this.level + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  NotesManager.prototype.importFromFile = function (file) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var imported = JSON.parse(e.target.result);
          if (imported.app !== 'CET6-Practice') {
            reject(new Error('文件格式不正确，请选择本应用导出的备份文件。'));
            return;
          }
          var doReplace = confirm(
            '检测到备份文件（来自 ' + (imported.exportedAt ? formatTime(new Date(imported.exportedAt).getTime()) : '未知时间') + '）。\n\n' +
            '点击「确定」替换当前所有数据，\n点击「取消」仅合并新内容。'
          );
          if (doReplace) {
            self.data = imported.data;
          } else {
            var existingIds = {};
            self.data.entries.forEach(function (e) { existingIds[e.id] = true; });
            (imported.data.entries || []).forEach(function (entry) {
              if (!existingIds[entry.id]) self.data.entries.push(entry);
            });
            if (imported.data.quickNote && !self.data.quickNote) {
              self.data.quickNote = imported.data.quickNote;
            }
          }
          if (!self.data.version) self.data.version = 2;
          if (!self.data.entries) self.data.entries = [];
          if (!self.data.planChecks) self.data.planChecks = {};
          self._save();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('文件读取失败')); };
      reader.readAsText(file);
    });
  };

  // ── Static helpers ───────────────────────────────────────

  NotesManager.CATEGORIES = CATEGORIES;
  NotesManager.formatTime = formatTime;
  NotesManager.generateExamId = generateExamId;

  NotesManager.initEmojiBars = function () {
    document.querySelectorAll('.emoji-bar').forEach(function (bar) {
      var targetId = bar.getAttribute('data-target');
      var textarea = document.getElementById(targetId);
      if (!textarea) return;
      bar.addEventListener('click', function (e) {
        var btn = e.target.closest('.emoji-btn');
        if (!btn) return;
        var emoji = btn.getAttribute('data-emoji');
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var val = textarea.value;
        textarea.value = val.slice(0, start) + emoji + val.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      });
    });
  };

  window.NotesManager = NotesManager;
})();
