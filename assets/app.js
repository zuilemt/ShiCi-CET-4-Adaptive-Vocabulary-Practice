/* =========================================================
   拾词 CET-4 · application
   ========================================================= */
(function () {
  "use strict";

  const DAY = 86400000;
  const STORAGE_KEY = "shici_cet4_state_v1";
  const MAX_NEW_PER_SESSION = 10;
  const MAX_REVIEW_PER_SESSION = 30;

  const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const WEEK_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
  const WEEK_EN = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

  const DEFAULT_THEME_COLOR = "#2f7b58";
  const THEME_PRESETS = [
    { id: "forest", name: "森林", color: "#2f7b58" },
    { id: "ocean", name: "海蓝", color: "#2f6f8f" },
    { id: "indigo", name: "靛青", color: "#4f5fa8" },
    { id: "clay", name: "赭石", color: "#a9603a" },
    { id: "rose", name: "莓红", color: "#a84f66" },
    { id: "graphite", name: "石墨", color: "#58605a" }
  ];

  const STUDY_MODES = {
    manual: {
      label: "手动模式",
      short: "手动",
      description: "固定每日新词量，达到目标后今天不再追加。适合想自己掌控节奏的时候。"
    },
    auto: {
      label: "自动模式",
      short: "自动",
      description: "由记忆引擎根据正确率和反应速度，每组自动调整词量，范围 6–36。"
    },
    hybrid: {
      label: "混合模式",
      short: "混合",
      description: "先完成手动目标，达到后询问是否继续；继续时按本组表现自动追加一小批。"
    }
  };

  /* ---------------- data ---------------- */

  const GROUPS = Array.isArray(window.CET4_GROUPS) ? window.CET4_GROUPS : [];
  const WORDS = [];
  const BY_ID = new Map();
  const ID_ALIASES = { analyse: "analyze", behaviour: "behavior" };

  GROUPS.forEach(function (group, groupIndex) {
    (group.words || []).forEach(function (row) {
      let id = String(row[5] || row[0]).toLowerCase();
      if (ID_ALIASES[id] && BY_ID.has(ID_ALIASES[id])) id = ID_ALIASES[id];
      if (BY_ID.has(id)) {
        // PDF 词表在后加载：同名词条以 PDF 的释义和音标为准，保留已有的例句和分组。
        const existing = BY_ID.get(id);
        if (row[2]) existing.meaning = row[2];
        if (row[1]) existing.ipa = row[1];
        if (id === "analyze" && existing.word === "analyze") existing.meaning = "v. 分析；分解";
        const sourceWord = String(row[0] || "");
        const alias = sourceWord.replace(/\(([^)]*)\)/g, "$1").split("/")[0].trim();
        if (alias && alias.toLowerCase() !== existing.word.toLowerCase()) {
          existing.aliases = existing.aliases || [];
          if (!existing.aliases.some(function (item) { return item.toLowerCase() === alias.toLowerCase(); })) {
            existing.aliases.push(alias);
          }
        }
        return;
      }
      const item = {
        id: id,
        word: row[0],
        ipa: row[1],
        meaning: row[2],
        example: row[3] || "",
        exampleZh: row[4] || "",
        group: group.name,
        groupIntro: group.intro || "",
        groupIndex: groupIndex,
        order: WORDS.length
      };
      WORDS.push(item);
      BY_ID.set(item.id, item);
    });
  });

  /* ---------------- helpers ---------------- */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function studyMode() {
    const mode = state.profile.studyMode;
    return STUDY_MODES[mode] ? mode : "auto";
  }

  function studyModeLabel(mode) {
    const key = mode || studyMode();
    return (STUDY_MODES[key] || STUDY_MODES.auto).label;
  }

  function wordOrder() {
    return state.profile.wordOrder === "random" ? "random" : "sequential";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeHexColor(value) {
    let hex = String(value == null ? "" : value).trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(hex)) {
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
  }

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    let hue = 0;
    let saturation = 0;
    if (max !== min) {
      const delta = max - min;
      saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue /= 6;
    }
    return { h: hue * 360, s: saturation * 100, l: lightness * 100 };
  }

  function hslToHex(hue, saturation, lightness) {
    const h = ((Number(hue) % 360) + 360) % 360;
    const s = clamp(Number(saturation), 0, 100) / 100;
    const l = clamp(Number(lightness), 0, 100) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    function channel(value) {
      return Math.round((value + m) * 255).toString(16).padStart(2, "0");
    }
    return "#" + channel(r) + channel(g) + channel(b);
  }

  function mixHex(first, second, firstWeight) {
    const a = hexToRgb(first);
    const b = hexToRgb(second);
    const weight = clamp(Number(firstWeight), 0, 1);
    const channels = [0, 1, 2].map(function (index) {
      return Math.round(a[index] * weight + b[index] * (1 - weight)).toString(16).padStart(2, "0");
    });
    return "#" + channels.join("");
  }

  function presetForColor(color) {
    return THEME_PRESETS.find(function (preset) { return preset.color === color; }) || null;
  }

  function currentThemeName() {
    const preset = presetForColor(state.settings.themeColor);
    return preset ? preset.name : "自定义";
  }

  function icon(name) {
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function dateKey(input) {
    const d = input instanceof Date ? input : (input == null ? new Date() : new Date(input));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function parseDateKey(key) {
    const parts = String(key).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function startOfDay(input) {
    const d = typeof input === "string" ? parseDateKey(input) : new Date(input == null ? Date.now() : input);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayGap(fromKey, toKey) {
    return Math.round((startOfDay(toKey) - startOfDay(fromKey)) / DAY);
  }

  function formatPercent(value) {
    if (value == null || isNaN(value)) return "--";
    return Math.round(value * 100) + "%";
  }

  function formatSeconds(ms) {
    if (!ms && ms !== 0) return "--";
    return (ms / 1000).toFixed(1);
  }

  function formatLongDate() {
    const now = new Date();
    return (now.getMonth() + 1) + "月" + now.getDate() + "日 · " + WEEK_CN[now.getDay()];
  }

  function formatEnglishDate() {
    const now = new Date();
    return WEEK_EN[now.getDay()] + " · " + MONTH_EN[now.getMonth()] + " " + now.getDate();
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 6) return "夜深了";
    if (hour < 11) return "早上好";
    if (hour < 13) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function dueText(timestamp) {
    if (!timestamp) return "未安排";
    const diff = timestamp - Date.now();
    if (diff <= 0) {
      const days = Math.floor((startOfDay(Date.now()) - startOfDay(timestamp)) / DAY);
      if (days <= 0) return "今天到期";
      if (days === 1) return "逾期 1 天";
      return "逾期 " + days + " 天";
    }
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + " 分钟后";
    const days = Math.round((startOfDay(timestamp) - startOfDay(Date.now())) / DAY);
    if (days <= 0) return "今天";
    if (days === 1) return "明天";
    if (days < 30) return days + " 天后";
    return Math.round(days / 30) + " 个月后";
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  function posOf(meaning) {
    const match = String(meaning).match(/^([a-z]+\.)/i);
    return match ? match[1].toLowerCase() : "";
  }

  function normalizeMeaning(meaning) {
    return String(meaning).replace(/\s+/g, "").replace(/[；;，,。.]/g, "");
  }

  function highlightWord(sentence, word) {
    const safe = escapeHTML(sentence);
    const pattern = new RegExp("(" + escapeRegExp(word) + "[a-z]*)", "ig");
    return safe.replace(pattern, "<mark>$1</mark>");
  }

  function extractExample(item) {
    if (!item.example || !item.exampleZh) return "";
    return '<div class="example-block">' +
      '<p class="example-en">' + highlightWord(item.example, item.word) + "</p>" +
      '<p class="example-cn">' + escapeHTML(item.exampleZh) + "</p>" +
      "</div>";
  }

  /* ---------------- state ---------------- */

  function blankState() {
    return {
      version: 1,
      app: "shici-cet4",
      createdAt: Date.now(),
      settings: {
        theme: "auto",
        themeColor: DEFAULT_THEME_COLOR,
        autoSpeak: false,
        sound: true,
        haptics: true
      },
      profile: {
        newPerDay: 18,
        studyMode: "auto",
        wordOrder: "sequential",
        challenge: 0.42,
        speedMs: null,
        accuracy: null,
        totalReviews: 0,
        totalCorrect: 0,
        streak: 0,
        lastStudyDay: null,
        daysStudied: 0,
        sessions: []
      },
      words: {},
      daily: {},
      recent: []
    };
  }

  function normalizeState(raw) {
    const base = blankState();
    if (!raw || typeof raw !== "object") return base;
    const state = {
      version: 1,
      app: "shici-cet4",
      createdAt: raw.createdAt || base.createdAt,
      settings: Object.assign(base.settings, raw.settings && typeof raw.settings === "object" ? raw.settings : {}),
      profile: Object.assign(base.profile, raw.profile && typeof raw.profile === "object" ? raw.profile : {}),
      words: raw.words && typeof raw.words === "object" ? raw.words : {},
      daily: raw.daily && typeof raw.daily === "object" ? raw.daily : {},
      recent: Array.isArray(raw.recent) ? raw.recent.slice(-60) : []
    };
    if (!Array.isArray(state.profile.sessions)) state.profile.sessions = [];
    if (!STUDY_MODES[state.profile.studyMode]) {
      const legacyAuto = !raw.profile || raw.profile.autoPlan !== false;
      state.profile.studyMode = legacyAuto ? "auto" : "manual";
    }
    const savedDailyGoal = Math.floor(Number(state.profile.newPerDay));
    state.profile.newPerDay = Number.isFinite(savedDailyGoal) && savedDailyGoal >= 1 ? savedDailyGoal : 18;
    if (state.profile.studyMode === "auto") {
      state.profile.newPerDay = clamp(state.profile.newPerDay, 6, 36);
    }
    if (!["sequential", "random"].includes(state.profile.wordOrder)) {
      state.profile.wordOrder = "sequential";
    }
    state.profile.challenge = clamp(Number(state.profile.challenge) || 0.42, 0.12, 0.94);
    if (!["auto", "light", "dark"].includes(state.settings.theme)) state.settings.theme = "auto";
    state.settings.themeColor = normalizeHexColor(state.settings.themeColor) || DEFAULT_THEME_COLOR;
    return state;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("拾词：读取本地数据失败", error);
      return blankState();
    }
  }

  let state = loadState();

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("拾词：保存失败", error);
      toast("浏览器存储空间不足，这次进度可能没有保存");
    }
  }

  function ensureWordRecord(id) {
    if (!state.words[id]) {
      state.words[id] = {
        seen: 0,
        checks: 0,
        correct: 0,
        reps: 0,
        lapses: 0,
        ease: 2.5,
        interval: 0,
        due: 0,
        strength: 0,
        repeatRequired: 0,
        repeatCorrect: 0,
        remembered: false,
        rememberedAt: 0,
        firstSeen: Date.now(),
        lastSeen: 0,
        lastMs: 0
      };
    }
    const rec = state.words[id];
    rec.seen = Number(rec.seen) || 0;
    rec.checks = Number(rec.checks) || 0;
    rec.correct = Number(rec.correct) || 0;
    rec.reps = Number(rec.reps) || 0;
    rec.lapses = Number(rec.lapses) || 0;
    rec.ease = clamp(Number(rec.ease) || 2.5, 1.3, 2.8);
    rec.interval = Number(rec.interval) || 0;
    rec.due = Number(rec.due) || 0;
    rec.strength = Number(rec.strength) || 0;
    rec.repeatRequired = clamp(Number(rec.repeatRequired) || 0, 0, 3);
    rec.repeatCorrect = clamp(Number(rec.repeatCorrect) || 0, 0, 3);
    if (rec.repeatRequired > 0 && rec.repeatCorrect >= 3) {
      rec.repeatRequired = 0;
      rec.repeatCorrect = 0;
    }
    if (!rec.repeatRequired) rec.repeatCorrect = 0;
    rec.remembered = !!rec.remembered;
    rec.rememberedAt = Number(rec.rememberedAt) || 0;
    return rec;
  }

  function isMastered(rec) {
    return !!rec && (rec.remembered || (rec.interval >= 14 && rec.reps >= 3));
  }

  function statusOf(rec) {
    if (!rec) return "new";
    if (rec.due <= Date.now()) return "due";
    if (isMastered(rec)) return "mastered";
    return "learning";
  }

  function strengthClass(strength) {
    if (strength >= 70) return "high";
    if (strength >= 40) return "mid";
    return "low";
  }

  function ensureToday() {
    const key = dateKey();
    if (!state.daily[key]) {
      state.daily[key] = {
        plan: state.profile.newPerDay,
        newIntroduced: 0,
        reviews: 0,
        correct: 0,
        totalMs: 0,
        correctMs: 0,
        completed: false
      };
    }
    const day = state.daily[key];
    day.plan = Number(day.plan) || state.profile.newPerDay;
    day.newIntroduced = Number(day.newIntroduced) || 0;
    day.reviews = Number(day.reviews) || 0;
    day.correct = Number(day.correct) || 0;
    day.totalMs = Number(day.totalMs) || 0;
    day.correctMs = Number(day.correctMs) || 0;
    day.hybridStopped = !!day.hybridStopped;
    day.hybridExtensions = Number(day.hybridExtensions) || 0;
    day.hybridLastPromptPlan = Number(day.hybridLastPromptPlan) || 0;
    return day;
  }

  function dueList() {
    const now = Date.now();
    const list = [];
    Object.keys(state.words).forEach(function (id) {
      const word = BY_ID.get(id);
      const rec = state.words[id];
      if (!word || !rec) return;
      if (Number(rec.due) > 0 && Number(rec.due) <= now) {
        list.push({ word: word, rec: rec });
      }
    });
    return list.sort(function (a, b) { return a.rec.due - b.rec.due; });
  }

  function hardList() {
    const list = [];
    Object.keys(state.words).forEach(function (id) {
      const word = BY_ID.get(id);
      const rec = state.words[id];
      if (word && rec && Number(rec.lapses) > 0) list.push({ word: word, rec: rec });
    });
    return list.sort(function (a, b) { return b.rec.lapses - a.rec.lapses; });
  }

  function masteredCount() {
    let count = 0;
    Object.keys(state.words).forEach(function (id) {
      if (isMastered(state.words[id])) count += 1;
    });
    return count;
  }

  function learnedCount() {
    return Object.keys(state.words).filter(function (id) { return !!BY_ID.get(id); }).length;
  }

  function remainingToday() {
    const day = ensureToday();
    let unseen = 0;
    WORDS.forEach(function (word) { if (!state.words[word.id]) unseen += 1; });
    return {
      new: Math.min(unseen, Math.max(0, day.plan - day.newIntroduced)),
      due: dueList().length
    };
  }

  function getRecentStats(limit) {
    const max = limit || 40;
    const arr = state.recent.slice(-max);
    const total = arr.length;
    const correct = arr.filter(function (item) { return item.correct; }).length;
    const correctItems = arr.filter(function (item) { return item.correct && Number(item.ms) > 0; });
    return {
      total: total,
      correct: correct,
      accuracy: total ? correct / total : null,
      speedMs: correctItems.length ? median(correctItems.map(function (item) { return Number(item.ms); })) : null
    };
  }

  function difficultyLevel() {
    return clamp(1 + Math.round(Number(state.profile.challenge || 0.42) * 4), 1, 5);
  }

  function difficultyLabel(level) {
    return ["轻松", "舒适", "标准", "挑战", "冲刺"][clamp(level, 1, 5) - 1];
  }

  function difficultyHint(level) {
    if (level <= 2) return "先把节奏放稳，干扰项会随着状态逐步增加";
    if (level === 3) return "四选一，同词性干扰";
    if (level === 4) return "四选一，干扰更接近";
    return "五选一，进入冲刺模式";
  }

  function currentStreak() {
    const last = state.profile.lastStudyDay;
    if (!last) return 0;
    const gap = dayGap(last, dateKey());
    return gap <= 1 ? Number(state.profile.streak) || 0 : 0;
  }

  function touchStreak() {
    const today = dateKey();
    if (state.profile.lastStudyDay === today) return;
    const yesterday = dateKey(Date.now() - DAY);
    state.profile.streak = state.profile.lastStudyDay === yesterday ? (Number(state.profile.streak) || 0) + 1 : 1;
    state.profile.lastStudyDay = today;
    state.profile.daysStudied = (Number(state.profile.daysStudied) || 0) + 1;
  }

  function calcStrength(rec) {
    const intervalScore = clamp(Math.log2(Math.max(rec.interval, 0) + 1) / Math.log2(31), 0, 1);
    const accuracy = rec.checks ? rec.correct / rec.checks : 0.6;
    return Math.round(clamp(intervalScore * 68 + accuracy * 32 - Math.min(rec.lapses * 2, 10), 3, 100));
  }

  function applySchedule(id, quality, ms, mode) {
    const rec = ensureWordRecord(id);
    const now = Date.now();
    rec.seen += 1;
    rec.lastSeen = now;
    rec.lastMs = Math.round(ms || 0);
    if (mode !== "learn") {
      rec.checks += 1;
      if (quality >= 3) rec.correct += 1;
    }

    if (quality < 3) {
      rec.lapses += 1;
      rec.reps = 0;
      rec.ease = clamp(rec.ease - 0.2, 1.3, 2.7);
      rec.interval = 0;
      rec.due = now + (mode === "learn" ? 6 : 9) * 60000;
    } else {
      rec.reps += 1;
      rec.ease = clamp(rec.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)), 1.3, 2.8);
      if (rec.reps === 1) {
        rec.interval = mode === "learn" && quality < 5 ? 0.025 : 1;
      } else if (rec.reps === 2) {
        rec.interval = quality >= 4 ? 3 : 1;
      } else {
        const speedAdjust = clamp(1 - ((ms || 2200) - 1800) / 12000, 0.72, 1.1);
        rec.interval = clamp(Math.round(rec.interval * rec.ease * speedAdjust), 1, 180);
      }
      if (mode === "learn" && quality < 5) {
        rec.interval = Math.min(rec.interval, 0.04);
      }
      rec.due = now + Math.max(rec.interval, 0.01) * DAY;
    }
    rec.strength = calcStrength(rec);
    return rec;
  }

  function armRepeat(rec) {
    rec.repeatRequired = 3;
    rec.repeatCorrect = 0;
    rec.remembered = false;
    rec.due = Date.now();
  }

  function completeRepeat(rec) {
    rec.repeatRequired = 0;
    rec.repeatCorrect = 0;
    rec.remembered = true;
    rec.rememberedAt = Date.now();
  }

  function updateMetrics(correct, ms) {
    state.recent.push({ t: Date.now(), ms: Math.round(ms || 0), correct: !!correct });
    if (state.recent.length > 60) state.recent = state.recent.slice(-60);
    const stats = getRecentStats(40);
    state.profile.accuracy = stats.accuracy;
    state.profile.speedMs = stats.speedMs;
    state.profile.totalReviews = (Number(state.profile.totalReviews) || 0) + 1;
    if (correct) state.profile.totalCorrect = (Number(state.profile.totalCorrect) || 0) + 1;
  }

  /* ---------------- theme / speech / sound ---------------- */

  let voices = [];
  let audioContext = null;

  function applyPalette() {
    const hex = normalizeHexColor(state.settings.themeColor) || DEFAULT_THEME_COLOR;
    const hsl = rgbToHsl.apply(null, hexToRgb(hex));
    const hue = hsl.h;
    const saturation = clamp(hsl.s, 6, 82);
    const baseLightness = clamp(hsl.l, 24, 55);
    const isDark = document.documentElement.dataset.theme === "dark";
    let palette;

    if (isDark) {
      const solid = hslToHex(hue, saturation, clamp(baseLightness - 1, 30, 40));
      palette = {
        "--green": hslToHex(hue, saturation, clamp(baseLightness + 26, 58, 76)),
        "--green-2": hslToHex(hue, saturation, clamp(baseLightness + 22, 52, 70)),
        "--green-deep": hslToHex(hue, saturation, clamp(baseLightness - 14, 8, 18)),
        "--green-solid": solid,
        "--green-solid-hover": mixHex(solid, "#000000", 0.86),
        "--on-green": "#fff9ed",
        "--green-soft": mixHex(solid, "#1a221c", 0.2),
        "--mint": hslToHex(hue, saturation, clamp(baseLightness + 34, 72, 84)),
        "--hero-1": hslToHex(hue, saturation, clamp(baseLightness - 8, 16, 28)),
        "--hero-2": hslToHex(hue, saturation, clamp(baseLightness - 14, 12, 23)),
        "--hero-3": hslToHex(hue, saturation, clamp(baseLightness - 20, 8, 18))
      };
    } else {
      const green2 = hslToHex(hue, saturation, clamp(baseLightness, 30, 38));
      const solid = hslToHex(hue, saturation, clamp(baseLightness - 7, 22, 33));
      palette = {
        "--green": hslToHex(hue, saturation, clamp(baseLightness - 12, 18, 27)),
        "--green-2": green2,
        "--green-deep": hslToHex(hue, saturation, clamp(baseLightness - 20, 12, 24)),
        "--green-solid": solid,
        "--green-solid-hover": mixHex(solid, "#000000", 0.86),
        "--on-green": "#fff9ed",
        "--green-soft": mixHex(green2, "#fffdf8", 0.1),
        "--mint": hslToHex(hue, clamp(saturation, 12, 60), 72),
        "--hero-1": hslToHex(hue, saturation, clamp(baseLightness - 8, 20, 32)),
        "--hero-2": hslToHex(hue, saturation, clamp(baseLightness - 14, 15, 26)),
        "--hero-3": hslToHex(hue, saturation, clamp(baseLightness - 20, 11, 21))
      };
    }

    const root = document.documentElement.style;
    Object.keys(palette).forEach(function (key) { root.setProperty(key, palette[key]); });

    const favicon = document.getElementById("favicon");
    if (favicon) {
      const solid = palette["--green-solid"];
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="16" fill="' + solid + '"/>' +
        '<path d="M32 14c-9 7-14 14-14 22 0 7 6 12 14 12s14-5 14-12c0-8-5-15-14-22Z" fill="#fffdf8"/>' +
        '<path d="M32 20v26M32 30l7-5M32 37l-7-5" stroke="' + solid + '" stroke-width="2.4" stroke-linecap="round"/>' +
        "</svg>";
      favicon.setAttribute("href", "data:image/svg+xml," + encodeURIComponent(svg));
    }
  }

  function applyTheme() {
    const pref = state.settings.theme || "auto";
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = pref === "dark" || (pref === "auto" && prefersDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark ? "#0f1511" : "#f2ede2");
    applyPalette();
  }

  function loadVoices() {
    if (!("speechSynthesis" in window)) return;
    voices = window.speechSynthesis.getVoices() || [];
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      toast("当前浏览器不支持语音朗读");
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const spokenText = String(text || "").split(/[/(]/)[0].trim() || String(text || "");
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = "en-US";
      utterance.rate = 0.84;
      utterance.pitch = 1;
      if (!voices.length) loadVoices();
      const preferred = voices.find(function (voice) {
        return /en-US/i.test(voice.lang) && /Samantha|Google US English|Microsoft (Aria|Jenny|Zira)|Daniel/i.test(voice.name);
      }) || voices.find(function (voice) { return /^en(-|_)/i.test(voice.lang); });
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("拾词：朗读失败", error);
    }
  }

  function getAudioContext() {
    if (!state.settings.sound) return null;
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioContext = new AudioCtor();
    }
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function playTone(kind) {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = kind === "correct" ? [660, 880] : [220, 174];
    notes.forEach(function (frequency, index) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = kind === "correct" ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.055, now + index * 0.08 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.16);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now + index * 0.08);
      oscillator.stop(now + index * 0.08 + 0.18);
    });
  }

  function haptic(pattern) {
    if (!state.settings.haptics) return;
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (error) { /* ignore */ }
    }
  }

  /* ---------------- toast / modal / confetti ---------------- */

  let toastTimer = null;
  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2300);
  }

  function hideToast() {
    const el = document.getElementById("toast");
    if (!el) return;
    clearTimeout(toastTimer);
    toastTimer = null;
    el.classList.remove("show");
  }

  let modalConfirmCallback = null;
  let lastFocusedElement = null;

  function lockBody() {
    document.body.classList.add("modal-open");
  }

  function unlockBody() {
    const studyOpen = !document.getElementById("study").classList.contains("is-hidden");
    const modalOpen = !document.getElementById("modalLayer").classList.contains("is-hidden");
    if (!studyOpen && !modalOpen) document.body.classList.remove("modal-open");
  }

  function openModal(html) {
    stopConfetti();
    lastFocusedElement = document.activeElement;
    const layer = document.getElementById("modalLayer");
    const modal = document.getElementById("modal");
    modal.innerHTML = html;
    layer.classList.remove("is-hidden");
    lockBody();
    setTimeout(function () {
      const focusTarget = modal.querySelector("button, [href], input");
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }, 50);
  }

  function closeModal() {
    const layer = document.getElementById("modalLayer");
    if (!layer || layer.classList.contains("is-hidden")) return;
    layer.classList.add("is-hidden");
    document.getElementById("modal").innerHTML = "";
    modalConfirmCallback = null;
    unlockBody();
    if (lastFocusedElement && lastFocusedElement.focus) {
      try { lastFocusedElement.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
    }
  }

  function openConfirm(options) {
    modalConfirmCallback = options.onConfirm || null;
    openModal(
      '<div class="modal-head"><h3 class="modal-title">' + escapeHTML(options.eyebrow || "请确认") + "</h3>" +
      '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon("close") + "</button></div>" +
      '<div class="confirm-body">' +
      '<div class="confirm-icon">' + icon(options.danger ? "trash" : "info") + "</div>" +
      "<h3>" + escapeHTML(options.title || "确定吗？") + "</h3>" +
      "<p>" + escapeHTML(options.text || "") + "</p>" +
      '<div class="confirm-actions">' +
      '<button class="btn btn-ghost" data-action="close-modal">取消</button>' +
      '<button class="btn ' + (options.danger ? "btn-danger" : "btn-green") + '" data-action="modal-confirm">' +
      escapeHTML(options.confirmLabel || "确定") + "</button>" +
      "</div></div>"
    );
  }

  function runModalConfirm() {
    const callback = modalConfirmCallback;
    modalConfirmCallback = null;
    closeModal();
    if (callback) setTimeout(callback, 60);
  }

  let confettiTimer = 0;
  let confettiFrame = 0;

  function stopConfetti() {
    if (confettiTimer) {
      clearTimeout(confettiTimer);
      confettiTimer = 0;
    }
    if (confettiFrame) {
      cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
    }
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = "none";
  }

  function burstConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.getElementById("confettiCanvas");
    if (!canvas) return;
    stopConfetti();
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    canvas.style.display = "block";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#2f7b58", "#a8d8bd", "#d76b4c", "#c7973f", "#fff9ed"];
    const pieces = [];
    for (let i = 0; i < 110; i += 1) {
      pieces.push({
        x: width * (0.2 + Math.random() * 0.6),
        y: height * 0.32 + Math.random() * 70,
        vx: (Math.random() - 0.5) * 7,
        vy: -3 - Math.random() * 6,
        size: 3 + Math.random() * 6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.25,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 1
      });
    }
    const startedAt = performance.now();
    function frame(now) {
      const elapsed = now - startedAt;
      ctx.clearRect(0, 0, width, height);
      pieces.forEach(function (piece) {
        piece.vy += 0.16;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        piece.life = Math.max(0, 1 - elapsed / 2400);
        ctx.save();
        ctx.globalAlpha = piece.life;
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.65);
        ctx.restore();
      });
      if (elapsed < 2400) {
        confettiFrame = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, width, height);
        canvas.style.display = "none";
        confettiFrame = 0;
      }
    }
    confettiFrame = requestAnimationFrame(frame);
  }

  /* ---------------- chrome / navigation ---------------- */

  let currentView = "today";

  function updateChrome() {
    const due = dueList().length;
    document.querySelectorAll('[data-badge="due"]').forEach(function (badge) {
      badge.textContent = due > 99 ? "99+" : String(due);
      badge.hidden = due === 0;
    });
    const streak = currentStreak();
    document.querySelectorAll("[data-streak] b").forEach(function (el) { el.textContent = String(streak); });
    const today = ensureToday();
    const dot = document.querySelector('.nav-item[data-nav="today"] .nav-dot');
    if (dot) dot.hidden = today.completed || (today.newIntroduced === 0 && due === 0);

    const stats = getRecentStats(30);
    const sideText = document.getElementById("sideEngineText");
    if (sideText) {
      if (stats.total) {
        sideText.innerHTML = "近 " + stats.total + " 次 · 正确率 <b>" + formatPercent(stats.accuracy) +
          "</b><br>每日 " + state.profile.newPerDay + " 词 · 难度 " + difficultyLevel() + "/5";
      } else {
        sideText.textContent = "完成第一组后，我会记住你的反应速度。";
      }
    }
    const sideFill = document.getElementById("sideMeterFill");
    if (sideFill) sideFill.style.width = Math.round((Number(state.profile.challenge) || 0.42) * 100) + "%";
    const sideLabel = document.getElementById("sideMeterLabel");
    if (sideLabel) sideLabel.textContent = "难度 " + difficultyLevel() + "/5 · " + difficultyLabel(difficultyLevel());
  }

  function setView(name, options) {
    if (!["today", "review", "library", "profile", "settings"].includes(name)) name = "today";
    currentView = name;
    ["today", "review", "library", "profile", "settings"].forEach(function (key) {
      const view = document.getElementById("view-" + key);
      if (!view) return;
      const active = key === name;
      view.classList.toggle("is-active", active);
      view.hidden = !active;
    });
    document.querySelectorAll(".nav-item, .tab").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-nav") === name);
    });
    if (name === "today") renderToday();
    if (name === "review") renderReview();
    if (name === "library") renderLibrary();
    if (name === "profile") renderProfile();
    if (name === "settings") renderSettings();
    updateChrome();
    if (!options || options.scroll !== false) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function refreshCurrentView() {
    if (currentView === "today") renderToday();
    else if (currentView === "review") renderReview();
    else if (currentView === "library") renderLibrary();
    else if (currentView === "profile") renderProfile();
    else if (currentView === "settings") renderSettings();
    updateChrome();
  }

  /* ---------------- shared render pieces ---------------- */

  function pageHead(eyebrow, title, subtitle, sideHTML) {
    return '<div class="page-head"><div><p class="eyebrow">' + escapeHTML(eyebrow) + "</p>" +
      '<h1 class="page-title">' + title + "</h1>" +
      (subtitle ? '<p class="page-sub">' + subtitle + "</p>" : "") +
      "</div>" + (sideHTML ? '<div class="page-head-side">' + sideHTML + "</div>" : "") + "</div>";
  }

  function streakChip() {
    return '<span class="streak-chip">' + icon("flame") + "<b>" + currentStreak() + "</b> 天</span>";
  }

  function statCard(iconName, label, value, unit, foot, tone) {
    return '<div class="stat-card"><div class="stat-top"><span>' + escapeHTML(label) + "</span>" +
      '<span class="stat-icon ' + (tone || "") + '">' + icon(iconName) + "</span></div>" +
      '<div class="stat-value">' + value + (unit ? "<small>" + unit + "</small>" : "") + "</div>" +
      '<div class="stat-foot">' + foot + "</div></div>";
  }

  function renderWeekChart() {
    const days = [];
    let total = 0;
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const day = state.daily[key];
      const count = day ? (Number(day.reviews) || 0) + (Number(day.newIntroduced) || 0) : 0;
      total += count;
      days.push({ label: WEEK_SHORT[d.getDay()], count: count, today: i === 0 });
    }
    const max = Math.max.apply(null, days.map(function (day) { return day.count; }).concat([1]));
    const bars = days.map(function (day) {
      const height = day.count ? Math.max(7, Math.round((day.count / max) * 54)) : 3;
      return '<div class="bar-col' + (day.today ? " is-today" : "") + '">' +
        '<span class="bar-value">' + (day.count || "") + "</span>" +
        '<i class="bar-stack' + (day.count ? "" : " empty") + '" style="height:' + height + 'px"></i>' +
        '<span class="bar-label">' + day.label + "</span></div>";
    }).join("");
    return '<div class="chart-card"><div class="chart-top"><div class="chart-total">' + total +
      '<small>次学习</small></div><div class="chart-legend"><span class="legend-dot">学习</span>' +
      '<span class="legend-dot faint">本周</span></div></div>' +
      '<div class="week-chart">' + bars +
      (total === 0 ? '<span class="chart-empty">第一组完成后，节奏会在这里长出来</span>' : "") +
      "</div></div>";
  }

  function engineBars() {
    const stats = getRecentStats(40);
    const accuracy = stats.accuracy == null ? 0 : stats.accuracy;
    const speed = stats.speedMs || 0;
    const speedScore = speed ? clamp(1 - (speed - 1200) / 5000, 0.05, 1) : 0.5;
    const level = difficultyLevel();
    const rows = [
      { label: "正确率", value: stats.accuracy == null ? "--" : formatPercent(stats.accuracy), width: accuracy * 100 },
      { label: "反应速度", value: stats.speedMs ? formatSeconds(stats.speedMs) + "s" : "--", width: speedScore * 100 },
      { label: "当前难度", value: level + "/5", width: level * 20 }
    ];
    return rows.map(function (row) {
      return '<div class="engine-line"><span>' + row.label + "</span>" +
        '<span class="engine-track"><i style="width:' + Math.round(row.width) + '%"></i></span>' +
        "<b>" + row.value + "</b></div>";
    }).join("");
  }

  function wordRow(item, index) {
    const rec = state.words[item.id];
    const status = statusOf(rec);
    const strength = rec ? Math.round(rec.strength || 0) : 0;
    const strengthHTML = rec
      ? '<span class="strength-pill ' + strengthClass(strength) + '">' + strength + "%</span>"
      : "";
    return '<div class="word-row" role="button" tabindex="0" data-action="open-word" data-id="' + item.id + '">' +
      '<span class="word-index">' + (index + 1) + "</span>" +
      '<span class="word-main"><span class="word-en-line"><span class="word-en">' + escapeHTML(item.word) +
      '</span><span class="word-ipa">/' + escapeHTML(item.ipa) + "/</span></span>" +
      '<span class="word-meaning">' + escapeHTML(item.meaning) + "</span></span>" +
      '<span class="word-side"><span class="status-dot ' + status + '"></span>' + strengthHTML +
      '<button class="mini-speak" data-action="speak" data-word="' + escapeHTML(item.word) + '" aria-label="朗读 ' +
      escapeHTML(item.word) + '">' + icon("volume") + "</button></span></div>";
  }

  /* ---------------- today ---------------- */

  function adaptiveSentence() {
    const stats = getRecentStats(40);
    const day = ensureToday();
    const mode = studyMode();
    if (mode === "manual") {
      return "手动模式：每日固定 <b>" + state.profile.newPerDay + "</b> 词，达到目标后今天不再追加。";
    }
    if (mode === "hybrid") {
      if (day.hybridStopped) {
        return "手动目标已完成，今天先到这里；想加量时再调整目标或切换模式。";
      }
      if (day.newIntroduced >= day.plan) {
        return "手动目标已完成，可以选择继续，追加量会按本组表现自动决定。";
      }
      return "混合模式：先完成 <b>" + day.plan + "</b> 个新词，达到后再决定是否继续。";
    }
    if (!stats.total) {
      return "自动模式：先完成一组，我会根据你的<b>反应速度</b>自动调整词量和难度。";
    }
    return "最近 <b>" + stats.total + "</b> 次正确率 <b>" + formatPercent(stats.accuracy) +
      "</b>，平均反应 <b>" + (stats.speedMs ? formatSeconds(stats.speedMs) + "s" : "暂无") +
      "</b>。今日 <b>" + day.plan + " 词</b> · 难度 <b>" + difficultyLevel() + "/5</b>。";
  }

  function renderToday() {
    const view = document.getElementById("view-today");
    const day = ensureToday();
    const due = dueList();
    const remaining = remainingToday();
    const mastered = masteredCount();
    const learned = learnedCount();
    const stats = getRecentStats(40);
    const level = difficultyLevel();
    const hybridReadyToday = studyMode() === "hybrid" && day.plan > 0 && day.newIntroduced >= day.plan &&
      !day.hybridStopped && learned < WORDS.length;
    const done = remaining.new === 0 && due.length === 0 && !hybridReadyToday;
    const planPercent = day.plan ? clamp((day.newIntroduced / day.plan) * 100, 0, 100) : 0;

    let heroTitle;
    if (done) {
      heroTitle = "今天的词，<br>已经<em>拾</em>完了。";
    } else if (hybridReadyToday) {
      heroTitle = "手动目标完成了，<br>要再<em>拾</em>几个吗？";
    } else if (due.length > 10 && due.length >= remaining.new) {
      heroTitle = "先把到期的词，<br><em>收</em>回来。";
    } else {
      heroTitle = "今天也来<br><em>拾</em>几个词吧。";
    }

    let action = "start-mixed";
    let cta = "开始今日学习";
    if (done) {
      action = "open-profile";
      cta = "查看记忆报告";
    } else if (hybridReadyToday) {
      action = "prompt-hybrid";
      cta = "继续背新词";
    } else if (remaining.new === 0 && due.length) {
      action = "start-review";
      cta = "开始复习";
    }

    const goalNumber = done ? "✓" : (hybridReadyToday ? "+" : (remaining.new || due.length));
    const goalLabel = done ? "今日完成" : (hybridReadyToday ? "可继续新词" : (remaining.new ? "个新词待学" : "个词待复习"));
    const minutes = Math.max(1, Math.ceil((remaining.new * 22 + due.length * 9) / 60));

    view.innerHTML =
      pageHead(formatEnglishDate(), "今日", "第 " + ((Number(state.profile.daysStudied) || 0) + (currentStreak() ? 0 : 1)) +
        " 天 · " + (day.newIntroduced ? "已学 " + day.newIntroduced + " / " + day.plan + " 个新词" : "今日计划 " + day.plan + " 个新词"), streakChip()) +
      '<section class="hero">' +
        '<div class="hero-top"><div><p class="hero-greeting">' + greeting() + " · " + escapeHTML(formatLongDate()) + "</p>" +
        '<h2 class="hero-title">' + heroTitle + "</h2></div>" +
        '<div class="hero-goal"><strong>' + goalNumber + "</strong><span>" + goalLabel + "</span></div></div>" +
        '<div class="reason-pill">' + icon("brain") + "<span>" + adaptiveSentence() + "</span></div>" +
        '<div class="hero-plan"><div class="plan-meta">' +
          '<div class="plan-figure"><strong>' + day.newIntroduced + "/" + day.plan + '</strong><span>今日新词</span></div>' +
          '<div class="plan-figure"><strong>' + due.length + '</strong><span>到期复习</span></div>' +
          '<div class="plan-figure"><strong>' + minutes + '</strong><span>预计分钟</span></div>' +
        "</div>" +
        '<button class="btn btn-cream" data-action="' + action + '">' + cta + icon("arrow") + "</button></div>" +
        '<div class="hero-progress"><span class="track"><i style="width:' + planPercent + '%"></i></span>' +
        "<span>" + Math.round(planPercent) + "% 计划</span></div>" +
        '<div class="hero-stats"><span>待复习 <b>' + due.length + "</b></span><i></i>" +
        "<span>已掌握 <b>" + mastered + "</b></span><i></i>" +
        "<span>词库 <b>" + learned + "/" + WORDS.length + "</b></span></div>" +
      "</section>" +
      '<div class="stat-grid">' +
        statCard("review", "待复习", String(due.length), "词", due.length ? "从最久的开始" : "今天没有积压", "accent") +
        statCard("bolt", "记忆速度", stats.speedMs ? formatSeconds(stats.speedMs) : "—", stats.speedMs ? "s" : "",
          stats.speedMs ? "近 " + stats.total + " 次作答" : (stats.total ? "暂无正确作答" : "完成一组后生成"), "gold") +
        statCard("target", "已掌握", String(mastered), "词",
          "覆盖词库 " + Math.round((mastered / Math.max(WORDS.length, 1)) * 100) + "%", "") +
      "</div>" +
      '<div class="section-head"><h2 class="section-title">' + icon("trend") + ' 本周节奏</h2>' +
      '<button class="section-link" data-nav="profile">查看统计' + icon("chevron") + "</button></div>" +
      renderWeekChart() +
      '<div class="section-head"><h2 class="section-title">' + icon("brain") + ' 你的记忆引擎</h2>' +
      '<button class="section-link" data-action="show-algo">了解规则' + icon("chevron") + "</button></div>" +
      '<div class="engine-card"><div class="engine-copy"><h3>把节奏交给表现</h3>' +
      "<p>答得又准又快，明天就多拾几个、把干扰项调近；犹豫和混淆变多，就自动放慢，先把词拾稳。" +
      '<br><button class="algo-link" data-action="show-algo">它是怎么算的 ' + icon("arrow") + "</button></p></div>" +
      '<div class="engine-bars">' + engineBars() + "</div></div>" +
      '<div class="section-head"><h2 class="section-title">' + icon("leaf") + ' 记忆提示</h2></div>' +
      '<div class="engine-card"><div class="engine-copy"><h3>难度 ' + level + "/5 · " + difficultyLabel(level) + "</h3>" +
      "<p>" + difficultyHint(level) + "。每组结束都会重新校准；如果你更想自己掌控，可以在「设置」里切换手动词量。</p></div>" +
      '<div class="engine-bars"><div class="engine-line"><span>今日词量</span><span class="engine-track"><i style="width:' +
      Math.round(clamp(day.plan / 36, 0, 1) * 100) + '%"></i></span><b>' + day.plan + "</b></div>" +
      '<div class="engine-line"><span>新词进度</span><span class="engine-track"><i style="width:' + planPercent +
      '%"></i></span><b>' + day.newIntroduced + "</b></div>" +
      '<div class="engine-line"><span>连续天数</span><span class="engine-track"><i style="width:' +
      Math.round(clamp(currentStreak() / 30, 0, 1) * 100) + '%"></i></span><b>' + currentStreak() + "</b></div>" +
      "</div></div>";

    updateChrome();
  }

  /* ---------------- review ---------------- */

  let reviewTab = "due";

  function forecastDays() {
    const days = [];
    const todayStart = startOfDay(Date.now());
    for (let i = 0; i < 7; i += 1) {
      const start = todayStart + i * DAY;
      const end = start + DAY;
      let count = 0;
      Object.keys(state.words).forEach(function (id) {
        const rec = state.words[id];
        if (!rec || !BY_ID.get(id)) return;
        const due = Number(rec.due) || 0;
        if (i === 0) {
          if (due > 0 && due < end) count += 1;
        } else if (due >= start && due < end) {
          count += 1;
        }
      });
      const d = new Date(start);
      days.push({ label: i === 0 ? "今天" : WEEK_SHORT[d.getDay()], count: count, today: i === 0 });
    }
    return days;
  }

  function renderReview() {
    const view = document.getElementById("view-review");
    const due = dueList();
    const hard = hardList();
    const forecast = forecastDays();
    const max = Math.max.apply(null, forecast.map(function (day) { return day.count; }).concat([1]));
    const forecastHTML = forecast.map(function (day) {
      const height = day.count ? Math.max(7, Math.round((day.count / max) * 48)) : 3;
      return '<div class="forecast-col' + (day.today ? " is-today" : "") + '">' +
        '<span class="bar-value">' + (day.count || "") + "</span>" +
        '<i class="bar-stack' + (day.count ? "" : " empty") + '" style="height:' + height + 'px"></i>' +
        "<span>" + day.label + "</span></div>";
    }).join("");

    const list = reviewTab === "hard" ? hard : due;
    const rows = list.slice(0, 60).map(function (entry, index) {
      const rec = entry.rec;
      return '<div class="word-row" role="button" tabindex="0" data-action="open-word" data-id="' + entry.word.id + '">' +
        '<span class="word-index">' + (index + 1) + "</span>" +
        '<span class="word-main"><span class="word-en-line"><span class="word-en">' + escapeHTML(entry.word.word) +
        '</span><span class="word-ipa">/' + escapeHTML(entry.word.ipa) + "/</span></span>" +
        '<span class="word-meaning">' + escapeHTML(entry.word.meaning) + "</span></span>" +
        '<span class="word-side"><span class="strength-pill ' + strengthClass(rec.strength) + '">' +
        (reviewTab === "hard" ? "错 " + rec.lapses + " 次" : dueText(rec.due)) + "</span>" +
        '<button class="mini-speak" data-action="speak" data-word="' + escapeHTML(entry.word.word) +
        '" aria-label="朗读">' + icon("volume") + "</button></span></div>";
    }).join("");

    view.innerHTML =
      pageHead("REVIEW · SPACED REPETITION", "复习", "按记忆曲线把快要忘记的词，重新拾回来。", streakChip()) +
      '<section class="review-hero"><div class="review-hero-copy"><p class="eyebrow">DUE TODAY</p>' +
      '<div class="due-line"><strong class="due-number">' + due.length + '</strong><span class="due-unit">个词到期</span></div>' +
      "<p>" + (due.length ? "先复习到期词，再学新词，记忆会更牢。" : "今天没有到期的词，去拾几个新的吧。") + "</p></div>" +
      '<button class="btn btn-green" data-action="' + (due.length ? "start-review" : "start-mixed") + '">' +
      (due.length ? "开始复习" : "学习新词") + icon("arrow") + "</button>" +
      '<div class="review-hero-art"></div></section>' +
      '<div class="section-head"><h2 class="section-title">' + icon("calendar") + ' 未来 7 天</h2>' +
      '<span class="section-link">共 ' + forecast.reduce(function (sum, day) { return sum + day.count; }, 0) + " 词</span></div>" +
      '<div class="forecast-card"><div class="forecast-chart">' + forecastHTML + "</div></div>" +
      '<div class="review-list-head"><div class="review-tabs">' +
      '<button class="seg-btn' + (reviewTab === "due" ? " is-active" : "") + '" data-action="review-tab" data-tab="due">待复习 ' +
      due.length + "</button>" +
      '<button class="seg-btn' + (reviewTab === "hard" ? " is-active" : "") + '" data-action="review-tab" data-tab="hard">困难词 ' +
      hard.length + "</button></div>" +
      (reviewTab === "hard" && hard.length ? '<button class="section-link" data-action="start-hard">专项复习' +
        icon("arrow") + "</button>" : "") + "</div>" +
      (rows ? '<div class="word-list">' + rows + "</div>" :
        '<div class="empty-state"><div class="empty-orbit">' + icon("leaf") + "</div>" +
        "<h3>" + (reviewTab === "hard" ? "还没有困难词" : "复习清空了") + "</h3>" +
        "<p>" + (reviewTab === "hard" ? "答错过的词会出现在这里，方便你集中处理。" :
          "到期的词都已经复习完。可以继续学新词，或者让记忆休息一下。") + "</p>" +
        '<button class="btn btn-soft" data-action="' + (reviewTab === "hard" ? "start-mixed" : "start-mixed") + '">' +
        (reviewTab === "hard" ? "去学新词" : "学习新词") + "</button></div>");

    updateChrome();
  }

  /* ---------------- library ---------------- */

  const LIB_PAGE_SIZE = 30;
  const libState = { filter: "all", query: "", page: 1 };

  function libraryCounts() {
    let due = 0;
    let learning = 0;
    let mastered = 0;
    Object.keys(state.words).forEach(function (id) {
      const rec = state.words[id];
      if (!rec || !BY_ID.get(id)) return;
      if (rec.due <= Date.now()) due += 1;
      if (isMastered(rec)) mastered += 1;
      if (!isMastered(rec) && rec.due > Date.now()) learning += 1;
    });
    return {
      all: WORDS.length,
      new: WORDS.length - learnedCount(),
      learning: learning,
      due: due,
      mastered: mastered
    };
  }

  function filteredWords() {
    const now = Date.now();
    const query = libState.query.trim().toLowerCase();
    let list = WORDS.filter(function (item) {
      const rec = state.words[item.id];
      if (libState.filter === "new" && rec) return false;
      if (libState.filter === "due" && (!rec || rec.due > now)) return false;
      if (libState.filter === "learning" && (!rec || isMastered(rec) || rec.due <= now)) return false;
      if (libState.filter === "mastered" && !isMastered(rec)) return false;
      if (query) {
        const haystack = (item.word + " " + item.meaning + " " + item.group + " " +
          (item.aliases || []).join(" ")).toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    if (libState.filter === "due") {
      list.sort(function (a, b) { return (state.words[a.id].due || 0) - (state.words[b.id].due || 0); });
    } else if (libState.filter === "mastered") {
      list.sort(function (a, b) { return (state.words[b.id].lastSeen || 0) - (state.words[a.id].lastSeen || 0); });
    }
    return list;
  }

  function libraryPageItems(current, total) {
    if (total <= 9) {
      const all = [];
      for (let i = 1; i <= total; i += 1) all.push(i);
      return all;
    }
    const pages = new Set([1, total, current, current - 1, current + 1]);
    if (current <= 4) [2, 3, 4, 5].forEach(function (page) { pages.add(page); });
    if (current >= total - 3) {
      [total - 1, total - 2, total - 3, total - 4].forEach(function (page) { pages.add(page); });
    }
    const sorted = Array.from(pages)
      .filter(function (page) { return page >= 1 && page <= total; })
      .sort(function (a, b) { return a - b; });
    const items = [];
    sorted.forEach(function (page, index) {
      if (index && page - sorted[index - 1] > 1) items.push("gap");
      items.push(page);
    });
    return items;
  }

  function renderLibraryPager(page, totalPages) {
    if (totalPages <= 1) return "";
    const numberButtons = libraryPageItems(page, totalPages).map(function (item) {
      if (item === "gap") return '<span class="pager-ellipsis">…</span>';
      return '<button class="pager-number' + (item === page ? " is-active" : "") +
        '" data-action="lib-page" data-page="' + item + '" aria-label="第 ' + item + ' 页"' +
        (item === page ? ' aria-current="page"' : "") + ">" + item + "</button>";
    }).join("");
    return '<div class="pager-main">' +
      '<button class="pager-arrow prev" data-action="lib-page" data-page="' + (page - 1) +
      '"' + (page <= 1 ? " disabled" : "") + ' aria-label="上一页">' + icon("chevron") + "</button>" +
      '<div class="pager-numbers">' + numberButtons + "</div>" +
      '<button class="pager-arrow next" data-action="lib-page" data-page="' + (page + 1) +
      '"' + (page >= totalPages ? " disabled" : "") + ' aria-label="下一页">' + icon("chevron") + "</button>" +
      "</div>" +
      '<div class="pager-jump"><span>跳至</span><input id="pageJump" type="number" min="1" max="' +
      totalPages + '" value="' + page + '" aria-label="输入页码"><span>/ ' + totalPages +
      ' 页</span><button class="pager-go" data-action="lib-page-jump">跳转</button></div>';
  }

  function renderLibraryPagerBottom(page, totalPages) {
    if (totalPages <= 1) return "";
    return '<div class="pager-bottom-row">' +
      '<button class="pager-arrow prev" data-action="lib-page" data-page="' + (page - 1) +
      '"' + (page <= 1 ? " disabled" : "") + ' aria-label="上一页">' + icon("chevron") + "</button>" +
      '<span class="pager-position">第 ' + page + " / " + totalPages + " 页</span>" +
      '<button class="pager-arrow next" data-action="lib-page" data-page="' + (page + 1) +
      '"' + (page >= totalPages ? " disabled" : "") + ' aria-label="下一页">' + icon("chevron") + "</button>" +
      "</div>";
  }

  function goToLibraryPage(value) {
    const list = filteredWords();
    const totalPages = Math.max(1, Math.ceil(list.length / LIB_PAGE_SIZE));
    const page = clamp(parseInt(value, 10) || 1, 1, totalPages);
    libState.page = page;
    renderLibraryList();
    const anchor = document.getElementById("libraryPager") || document.getElementById("libraryList");
    if (anchor) {
      const top = anchor.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  function renderLibraryList() {
    const container = document.getElementById("libraryList");
    const meta = document.getElementById("libraryMeta");
    const pager = document.getElementById("libraryPager");
    if (!container) return;
    const list = filteredWords();
    const totalPages = Math.max(1, Math.ceil(list.length / LIB_PAGE_SIZE));
    libState.page = clamp(Number(libState.page) || 1, 1, totalPages);
    const start = (libState.page - 1) * LIB_PAGE_SIZE;
    const visible = list.slice(start, start + LIB_PAGE_SIZE);
    container.innerHTML = visible.length
      ? '<div class="word-list' + (visible.length === 1 ? " is-single" : "") + '">' +
        visible.map(function (item, index) {
          return wordRow(item, start + index);
        }).join("") + "</div>"
      : '<div class="empty-state"><div class="empty-orbit">' + icon("search") + "</div>" +
        "<h3>没有找到这个词</h3><p>换个拼写或中文关键词试试。词库共 " + WORDS.length + " 个词条。</p></div>";
    if (meta) {
      meta.innerHTML = "<span>第 <b>" + libState.page + "</b> / " + totalPages + " 页 · 共 <b>" +
        list.length + "</b> 个词</span>" +
        "<span>" + (libState.query ? "搜索：“" + escapeHTML(libState.query) + "”" : "按学习状态筛选") + "</span>";
    }
    if (pager) pager.innerHTML = renderLibraryPager(libState.page, totalPages);
    const pagerBottom = document.getElementById("libraryPagerBottom");
    if (pagerBottom) pagerBottom.innerHTML = renderLibraryPagerBottom(libState.page, totalPages);
  }

  function renderLibrary() {
    const view = document.getElementById("view-library");
    if (!view) return;
    const counts = libraryCounts();
    const filters = [
      { key: "all", label: "全部" },
      { key: "new", label: "未学习" },
      { key: "learning", label: "学习中" },
      { key: "due", label: "待复习" },
      { key: "mastered", label: "已掌握" }
    ];
    view.innerHTML =
      pageHead("LIBRARY · " + WORDS.length + " WORDS", "词库", "精选高频词 + 4 周计划词表，随时查、随时听。", streakChip()) +
      '<div class="library-tools"><div class="search-box">' + icon("search") +
      '<input id="searchInput" class="search-input" type="search" autocomplete="off" placeholder="搜索单词或中文释义…" value="' +
      escapeHTML(libState.query) + '" aria-label="搜索词库">' +
      '<button id="searchClear" class="search-clear' + (libState.query ? " show" : "") + '" data-action="clear-search" aria-label="清空搜索">' +
      icon("close") + "</button></div></div>" +
      '<div class="filter-row">' + filters.map(function (filter) {
        return '<button class="chip' + (libState.filter === filter.key ? " is-active" : "") + '" data-action="filter" data-filter="' +
          filter.key + '">' + filter.label + "<em>" + counts[filter.key] + "</em></button>";
      }).join("") + "</div>" +
      '<div class="library-meta" id="libraryMeta"></div>' +
      '<div class="library-pager" id="libraryPager" role="navigation" aria-label="词库分页"></div>' +
      '<div id="libraryList"></div>' +
      '<div class="library-pager pager-bottom" id="libraryPagerBottom" role="navigation" aria-label="词库分页"></div>';
    renderLibraryList();
    updateChrome();
  }

  /* ---------------- profile ---------------- */

  function sparklineSVG(values) {
    if (!values.length) return '<div class="spark-empty">完成一组后，这里会出现你的速度曲线</div>';
    const width = 180;
    const height = 80;
    const pad = 6;
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const range = max - min;
    const points = values.map(function (value, index) {
      const x = values.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (values.length - 1);
      const ratio = range === 0 ? 0.5 : (value - min) / range;
      const y = height - pad - (1 - ratio) * (height - pad * 2);
      return [x, y];
    });
    const path = points.map(function (point, index) {
      return (index ? "L" : "M") + point[0].toFixed(1) + " " + point[1].toFixed(1);
    }).join(" ");
    const area = path + " L" + points[points.length - 1][0].toFixed(1) + " " + (height - 2) +
      " L" + points[0][0].toFixed(1) + " " + (height - 2) + " Z";
    const last = points[points.length - 1];
    return '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" aria-label="记忆速度趋势">' +
      "<defs><linearGradient id=\"sparkGrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" +
      '<stop offset="0%" stop-color="var(--green-2)" stop-opacity=".24"/>' +
      '<stop offset="100%" stop-color="var(--green-2)" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#sparkGrad)"/>' +
      '<path d="' + path + '" fill="none" stroke="var(--green-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.4" fill="var(--green-2)" stroke="var(--surface)" stroke-width="2"/>' +
      "</svg>";
  }

  function speedLabel(ms) {
    if (!ms) return "等待第一组数据";
    if (ms <= 2300) return "反应很快";
    if (ms <= 3500) return "节奏稳定";
    if (ms <= 5000) return "还可以更熟";
    return "慢一点，也是在前进";
  }

  function settingsRow(key, title, description) {
    const enabled = !!state.settings[key];
    return '<div class="setting-row"><div class="setting-copy"><strong>' + escapeHTML(title) + "</strong><span>" +
      escapeHTML(description) + '</span></div><button class="switch' + (enabled ? " on" : "") +
      '" data-action="toggle-setting" data-key="' + key + '" role="switch" aria-checked="' + enabled +
      '" aria-label="' + escapeHTML(title) + '"></button></div>';
  }

  function renderProfile() {
    const view = document.getElementById("view-profile");
    const p = state.profile;
    const stats = getRecentStats(40);
    const level = difficultyLevel();
    const sessions = p.sessions.slice(-8);
    const speedValues = sessions.map(function (item) { return Number(item.speedMs) || 0; }).filter(function (value) { return value > 0; });
    const totalReviews = Number(p.totalReviews) || 0;
    const totalCorrect = Number(p.totalCorrect) || 0;
    const overallAccuracy = totalReviews ? totalCorrect / totalReviews : null;
    const startDate = new Date(state.createdAt || Date.now());
    const since = startDate.getFullYear() + "年" + (startDate.getMonth() + 1) + "月" + startDate.getDate() + "日";

    view.innerHTML =
      pageHead("PROFILE · MEMORY ENGINE", "我的", "所有学习记录只保存在这台设备的浏览器里。", streakChip()) +
      '<section class="profile-hero"><div class="profile-avatar">拾</div><div class="profile-id">' +
      "<h2>四级拾词人</h2><p>从 " + escapeHTML(since) + " 开始 · 已学习 " + learnedCount() + " 个词</p></div>" +
      '<div class="profile-stats"><div class="profile-stat"><strong>' + currentStreak() +
      "</strong><span>连续天数</span></div>" +
      '<div class="profile-stat"><strong>' + masteredCount() + "</strong><span>已掌握</span></div>" +
      '<div class="profile-stat"><strong>' + totalReviews + "</strong><span>总作答</span></div></div></section>" +
      '<div class="metric-grid" style="margin-top:12px">' +
      '<div class="metric-card"><div class="stat-top"><span>正确率</span><span class="stat-icon">' + icon("target") +
      '</span></div><div class="stat-value">' + formatPercent(overallAccuracy) + '</div><div class="metric-foot">全部作答</div></div>' +
      '<div class="metric-card"><div class="stat-top"><span>平均反应</span><span class="stat-icon gold">' + icon("bolt") +
      '</span></div><div class="stat-value">' + (stats.speedMs ? formatSeconds(stats.speedMs) : "—") +
      (stats.speedMs ? "<small>s</small>" : "") + '</div><div class="metric-foot">近 40 次正确作答</div></div>' +
      '<div class="metric-card"><div class="stat-top"><span>当前难度</span><span class="stat-icon accent">' + icon("brain") +
      '</span></div><div class="stat-value">' + level + "<small>/5</small></div><div class=\"metric-foot\">" +
      difficultyLabel(level) + "</div></div></div>" +
      '<div class="section-head"><h2 class="section-title">' + icon("bolt") + ' 记忆速度</h2>' +
      '<span class="section-link">' + speedValues.length + " 组数据</span></div>" +
      '<div class="panel speed-panel"><div class="speed-copy"><h3>反应越顺，拾得越牢 <small>LOWER IS FASTER</small></h3>' +
      '<p>这里记录的是你答对时的平均反应时间。速度不是目的，它只是记忆熟悉度的侧写。</p>' +
      '<div class="speed-big"><strong>' + (stats.speedMs ? formatSeconds(stats.speedMs) : "—") + "</strong><span>秒</span></div>" +
      '<span class="speed-label">' + speedLabel(stats.speedMs) + "</span></div>" +
      '<div><div class="spark-wrap">' + sparklineSVG(speedValues) + "</div>" +
      '<div class="spark-caption"><span>较早</span><span>越高越快 · 最近</span></div></div></div>' +
      '<div class="section-head"><h2 class="section-title">' + icon("settings") + ' 个性化</h2>' +
      '<button class="section-link" data-action="show-algo">算法说明' + icon("chevron") + "</button></div>" +
      '<div class="panel profile-settings-card">' +
        '<div class="settings-shortcut-copy"><h3>把拾词调成你的样子</h3>' +
        "<p>主题颜色、每日新词量、发音和数据备份，都集中在设置里。</p></div>" +
        '<div class="pref-summary">' +
          '<div class="pref-item"><span>主题色</span><b><i class="pref-dot" style="background:' +
          escapeHTML(state.settings.themeColor) + '"></i>' + escapeHTML(currentThemeName()) + "</b></div>" +
          '<div class="pref-item"><span>每日新词</span><b>' + p.newPerDay + " 词</b></div>" +
          '<div class="pref-item"><span>模式</span><b>' + escapeHTML(studyModeLabel()) + "</b></div>" +
        "</div>" +
        '<button class="btn btn-green btn-block" data-nav="settings">打开设置' + icon("arrow") + "</button>" +
      "</div>";

    updateChrome();
  }

  /* ---------------- settings ---------------- */

  function renderSettings() {
    const view = document.getElementById("view-settings");
    if (!view) return;
    const p = state.profile;
    const day = ensureToday();
    const hex = normalizeHexColor(state.settings.themeColor) || DEFAULT_THEME_COLOR;
    const activePreset = presetForColor(hex);
    const mode = state.settings.theme || "auto";
    const goalValues = [25, 30, 35, 40, 45, 50];
    const currentMode = studyMode();
    const modeInfo = STUDY_MODES[currentMode];
    const goalLabel = currentMode === "hybrid" ? "手动目标" : "每日新词";
    const goalNote = currentMode === "hybrid"
      ? "先完成手动目标；达到后会询问是否继续，继续时按本组表现自动追加 2–6 个新词。"
      : "固定每日新词量；达到目标后今天不会追加，到期复习另行安排。";
    const todayLine = currentMode === "hybrid" && day.plan !== p.newPerDay
      ? "今天已学 <b>" + day.newIntroduced + "</b> / 手动目标 <b>" + p.newPerDay + "</b> · 今日计划 <b>" + day.plan + "</b>"
      : "今天已学 <b>" + day.newIntroduced + "</b> / 计划 <b>" + day.plan + "</b> 个新词";

    const modeButtons = [
      { id: "auto", label: "跟随系统", iconName: "sparkle" },
      { id: "light", label: "浅色", iconName: "sun" },
      { id: "dark", label: "深色", iconName: "moon" }
    ].map(function (item) {
      return '<button class="mode-btn' + (mode === item.id ? " is-active" : "") +
        '" data-action="set-theme-mode" data-mode="' + item.id + '">' + icon(item.iconName) +
        "<span>" + item.label + "</span></button>";
    }).join("");

    const presets = THEME_PRESETS.map(function (preset) {
      const active = !!activePreset && activePreset.id === preset.id;
      return '<button class="theme-swatch' + (active ? " is-active" : "") +
        '" data-action="set-theme-color" data-color="' + preset.color + '" data-preset="' + preset.id + '">' +
        '<span class="swatch-dot" style="background:' + preset.color + '"></span>' +
        '<span class="swatch-copy"><strong>' + preset.name + "</strong><em>" + preset.color + "</em></span>" +
        '<span class="swatch-check">' + icon("check") + "</span></button>";
    }).join("");

    const goalChoices = goalValues.map(function (value) {
      return '<button class="goal-choice' + (p.newPerDay === value ? " is-active" : "") +
        '" data-action="set-goal" data-value="' + value + '">' + value + "</button>";
    }).join("");

    const modeOptions = Object.keys(STUDY_MODES).map(function (key) {
      const info = STUDY_MODES[key];
      return '<option value="' + key + '"' + (key === currentMode ? " selected" : "") + ">" +
        info.label + " · " + (key === "manual" ? "固定词量" : key === "auto" ? "引擎调节" : "完成后再决定") +
        "</option>";
    }).join("");

    const currentOrder = wordOrder();
    const orderButtons = [
      { id: "sequential", label: "顺序" },
      { id: "random", label: "乱序" }
    ].map(function (item) {
      const active = currentOrder === item.id;
      return '<button class="segment' + (active ? " is-active" : "") + '" data-action="set-word-order" data-order="' +
        item.id + '" aria-pressed="' + active + '">' + item.label + "</button>";
    }).join("");

    const goalEditor = currentMode === "auto"
      ? '<div class="auto-mode-card">' +
          '<div class="auto-mode-main"><span>当前自动目标</span><strong id="autoCurrentGoal">' + p.newPerDay +
          '</strong><em>词 / 天</em></div><span class="auto-range-pill">6–36</span></div>' +
          '<p class="settings-note">引擎每组结算后按正确率和反应速度微调词量，当前难度 ' + difficultyLevel() +
          "/5。今天已学 <b>" + day.newIntroduced + "</b> / 计划 <b>" + day.plan + "</b> 个新词。</p>"
      : '<div class="goal-editor">' +
          (currentMode === "hybrid"
            ? '<div class="mode-flow"><span>手动目标</span><i>→</i><span>完成提示</span><i>→</i><span>按表现追加</span></div>'
            : "") +
          '<div class="goal-line">' +
            '<button class="goal-step" data-action="adjust-goal" data-delta="-1" aria-label="减少' + goalLabel + '">−</button>' +
            '<div class="goal-value"><input class="goal-number-input" id="dailyGoalInput" type="number" min="1" step="1" inputmode="numeric" title="可直接输入' +
            goalLabel + '数量" value="' + p.newPerDay + '" aria-label="' + goalLabel + '数量"><span>词 / 天</span></div>' +
            '<button class="goal-step" data-action="adjust-goal" data-delta="1" aria-label="增加' + goalLabel + '">+</button>' +
          "</div>" +
          '<div class="goal-input-note">可直接输入数字 · 最少 1 个 · 不设上限</div>' +
          '<div class="goal-presets">' + goalChoices + "</div>" +
          '<p class="settings-note" id="dailyGoalHint">' + goalNote + "</p>" +
          '<div class="goal-today">' + todayLine + "</div>" +
        "</div>";

    view.innerHTML =
      pageHead("SETTINGS · MAKE IT YOURS", "设置", "调好颜色和节奏，让每天这一小会儿更像你自己的。", streakChip()) +
      '<div class="settings-layout">' +
        '<section class="panel settings-panel">' +
          '<div class="panel-head"><h2 class="panel-title">' + icon("sun") + ' 外观</h2>' +
          '<span class="settings-status">' + (mode === "auto" ? "跟随系统" : mode === "dark" ? "深色" : "浅色") + "</span></div>" +
          '<p class="panel-desc">深浅模式决定底色，主题色会渗透到按钮、进度、卡片和图表里。选择后立即生效。</p>' +
          '<div class="theme-mode" role="group" aria-label="深浅模式">' + modeButtons + "</div>" +
          '<div class="theme-color-head"><span>主题色</span><b id="currentThemeName">' + escapeHTML(currentThemeName()) +
          '</b><em id="currentThemeHex">' + escapeHTML(hex) + "</em>" +
          '<button class="text-link theme-reset" data-action="reset-theme-color">恢复默认</button></div>' +
          '<div class="theme-presets">' + presets + "</div>" +
          '<label class="custom-color' + (!activePreset ? " is-active" : "") + '" for="customColor">' +
            '<input type="color" id="customColor" value="' + escapeHTML(hex) + '" aria-label="自定义主题色">' +
            '<span class="color-dot" id="customColorDot" style="background:' + escapeHTML(hex) + '"></span>' +
            '<span class="custom-copy"><strong>自定义颜色</strong><em id="customColorValue">' + escapeHTML(hex) + "</em></span>" +
            '<span class="custom-arrow">' + icon("chevron") + "</span>" +
          "</label>" +
          '<div class="palette-preview" aria-label="当前配色预览">' +
            '<span style="background:var(--green-solid)"></span>' +
            '<span style="background:var(--green-2)"></span>' +
            '<span style="background:var(--green-soft)"></span>' +
            '<span style="background:var(--mint)"></span>' +
          "</div>" +
        "</section>" +
        '<section class="panel settings-panel">' +
          '<div class="panel-head"><h2 class="panel-title">' + icon("target") + ' 学习模式</h2>' +
          '<span class="settings-status">' + escapeHTML(modeInfo.label) + "</span></div>" +
          '<p class="panel-desc">' + escapeHTML(modeInfo.description) + "</p>" +
          '<label class="mode-select-field" for="studyModeSelect"><span>模式选择</span>' +
            '<span class="mode-select-wrap"><select id="studyModeSelect" class="mode-select">' + modeOptions +
            "</select>" + icon("chevron") + "</span></label>" +
          '<p class="mode-select-help">选择模式后，下方会展开对应设置。</p>' +
          '<div class="mode-detail">' + goalEditor + "</div>" +
          '<div class="setting-row word-order-row"><div class="setting-copy"><strong>背诵顺序</strong>' +
          "<span>控制新词出现的先后；到期复习仍按时间安排。</span></div>" +
          '<div class="segmented" role="group" aria-label="背诵顺序">' + orderButtons + "</div></div>" +
        "</section>" +
        '<section class="panel settings-panel">' +
          '<div class="panel-head"><h2 class="panel-title">' + icon("volume") + ' 学习手感</h2>' +
          '<span class="settings-status">' + (state.settings.autoSpeak ? "自动发音" : "手动发音") + "</span></div>" +
          '<p class="panel-desc">这些设置只影响学习时的声音与触感，不会改变记忆安排。</p>' +
          '<div class="setting-list">' +
            settingsRow("autoSpeak", "自动发音", "进入新词卡时自动朗读英文，也可以在卡片上点小喇叭。") +
            settingsRow("sound", "答题音效", "答对和答错时播放轻提示音。") +
            settingsRow("haptics", "震动反馈", "在支持的手机上给出轻触反馈。") +
          "</div>" +
        "</section>" +
        '<section class="panel settings-panel">' +
          '<div class="panel-head"><h2 class="panel-title">' + icon("download") + ' 数据与备份</h2>' +
          '<span class="settings-status">本机存储</span></div>' +
          '<p class="panel-desc">学习记录保存在这台设备的浏览器里。换设备或清理浏览器前，先导出一份 JSON 备份。</p>' +
          '<div class="data-actions"><button class="btn btn-soft" data-action="export">' + icon("download") + " 导出备份</button>" +
          '<button class="btn btn-soft" data-action="import">' + icon("upload") + " 导入备份</button>" +
          '<button class="btn btn-ghost danger-text" data-action="reset">' + icon("trash") + " 清空全部</button></div>" +
          '<p class="about-note">拾词 CET-4 · 收录 ' + WORDS.length + " 个词条 · " + GROUPS.length +
          " 个分组 · PDF 词表释义优先 · 数据仅存于本机 localStorage" +
          '<br><button class="algo-link" data-action="show-algo">了解记忆引擎如何工作 ' + icon("arrow") + "</button></p>" +
        "</section>" +
      "</div>";

    updateChrome();
  }

  /* =========================================================
     study session
     ========================================================= */

  let session = null;

  function optionCount() {
    const challenge = Number(state.profile.challenge) || 0.42;
    if (challenge < 0.22) return 3;
    if (challenge >= 0.875) return 5;
    return 4;
  }

  function buildOptions(word, count, field) {
    const useWord = field === "word";
    const textOf = function (item) { return useWord ? item.word : item.meaning; };
    const keyOf = function (item) {
      return useWord ? String(item.word).toLowerCase() : normalizeMeaning(item.meaning);
    };
    const pool = WORDS.filter(function (item) {
      return item.id !== word.id && keyOf(item) !== keyOf(word);
    });
    const targetPos = posOf(word.meaning);
    const challenge = Number(state.profile.challenge) || 0.42;
    const chosen = [];
    const usedKeys = new Set([keyOf(word)]);

    function takeFrom(list) {
      const shuffled = shuffle(list);
      shuffled.forEach(function (item) {
        if (chosen.length >= count - 1) return;
        const key = keyOf(item);
        if (usedKeys.has(key)) return;
        usedKeys.add(key);
        chosen.push({ id: item.id, text: textOf(item) });
      });
    }

    if (challenge >= 0.55) {
      takeFrom(pool.filter(function (item) {
        return posOf(item.meaning) === targetPos && item.group !== word.group;
      }));
    }
    if (chosen.length < count - 1) {
      takeFrom(pool.filter(function (item) { return posOf(item.meaning) === targetPos; }));
    }
    if (chosen.length < count - 1) takeFrom(pool);

    const options = chosen.slice(0, count - 1);
    options.push({ id: word.id, text: textOf(word) });
    return shuffle(options);
  }

  function qualityForQuiz(correct, ms) {
    if (!correct) return 1;
    if (ms < 2200) return 5;
    if (ms < 4200) return 4;
    return 3;
  }

  function interleave(learnItems, reviewItems, learnChunk, reviewChunk) {
    const output = [];
    let i = 0;
    let j = 0;
    while (i < learnItems.length || j < reviewItems.length) {
      for (let k = 0; k < learnChunk && i < learnItems.length; k += 1) output.push(learnItems[i++]);
      for (let k = 0; k < reviewChunk && j < reviewItems.length; k += 1) output.push(reviewItems[j++]);
    }
    return output;
  }

  function showStudy() {
    document.getElementById("study").classList.remove("is-hidden");
    lockBody();
  }

  function beginSession(mode, queue) {
    if (!queue.length) {
      toast("现在没有可学习的词，先休息一下");
      return;
    }
    stopConfetti();
    hideToast();
    session = {
      mode: mode,
      queue: queue,
      index: 0,
      groupIds: queue.filter(function (item) { return item.type === "learn"; }).map(function (item) { return item.id; }),
      groupRemembered: [],
      startedAt: Date.now(),
      itemStarted: performance.now(),
      answered: 0,
      newLearned: 0,
      reviewAnswered: 0,
      checkSerial: 0,
      correct: 0,
      correctMs: 0,
      wrongIds: [],
      learnedIds: [],
      revealed: false,
      quizAnswered: false,
      options: null,
      finished: false,
      summary: null
    };
    showStudy();
    updateStudyHeader();
    renderCurrent();
  }

  function nextNewWords(limit) {
    if (limit <= 0) return [];
    const unseen = WORDS.filter(function (word) { return !state.words[word.id]; });
    const ordered = wordOrder() === "random" ? shuffle(unseen) : unseen;
    return ordered.slice(0, limit);
  }

  function startSession(kind) {
    const day = ensureToday();
    let newLimit = 0;
    let due = [];

    if (kind !== "review") {
      newLimit = Math.min(MAX_NEW_PER_SESSION, Math.max(0, day.plan - day.newIntroduced));
    }
    if (kind !== "new") {
      due = dueList().slice(0, MAX_REVIEW_PER_SESSION);
    }

    const newItems = nextNewWords(newLimit)
      .map(function (word) { return { type: "learn", id: word.id, source: "new" }; });
    const reviewItems = due.map(function (entry) { return { type: "quiz", id: entry.word.id, source: "due" }; });

    let queue;
    if (kind === "review") queue = reviewItems;
    else queue = interleave(newItems, reviewItems, 3, 2);

    if (!queue.length) {
      if (day.plan - day.newIntroduced <= 0 && dueList().length === 0) {
        toast("今天的计划已经完成，明天再来拾几个词吧");
      } else if (newLimit === 0 && dueList().length === 0) {
        toast("今天的词已经学完了");
      } else {
        toast("现在没有可学习的词");
      }
      return;
    }
    beginSession(kind, queue);
  }

  function startMistakeSession(ids) {
    const list = (ids || []).map(function (id) { return BY_ID.get(id); }).filter(Boolean).slice(0, 20);
    if (!list.length) {
      toast("这一组没有错词，去学新的吧");
      return;
    }
    beginSession("mistake", list.map(function (word) {
      return { type: "quiz", id: word.id, source: "mistake" };
    }));
  }

  function currentItem() {
    return session ? session.queue[session.index] : null;
  }

  function updateStudyHeader() {
    if (!session) return;
    const groupSize = Array.isArray(session.groupIds) ? session.groupIds.length : 0;
    const remembered = Array.isArray(session.groupRemembered) ? session.groupRemembered.length : 0;
    const dots = document.getElementById("studyDots");
    const text = document.getElementById("studyProgressText");
    const progress = document.querySelector(".study-progress");
    if (progress) progress.classList.toggle("is-simple", !groupSize);
    if (dots) {
      dots.hidden = !groupSize;
      if (groupSize) {
        dots.innerHTML = session.groupIds.map(function (id, index) {
          return '<i class="study-dot' + (index < remembered ? " is-done" : "") + '"></i>';
        }).join("");
        dots.setAttribute("aria-label", "本组记住 " + remembered + " / " + groupSize);
      } else {
        dots.innerHTML = "";
      }
    }
    if (text) {
      text.textContent = groupSize
        ? remembered + " / " + groupSize
        : (session.finished ? "已完成" : (session.mode === "mistake" ? "错词" : "复习"));
    }
    const sound = document.getElementById("studySound");
    if (sound) sound.classList.toggle("is-muted", !state.settings.autoSpeak);
  }

  function renderCurrent() {
    if (!session) return;
    const item = currentItem();
    if (!item) {
      finishSession();
      return;
    }
    session.revealed = false;
    session.quizAnswered = false;
    session.options = null;
    session.itemStarted = performance.now();
    const stage = document.getElementById("studyBody");
    if (stage) stage.scrollTop = 0;
    document.getElementById("studyFoot").innerHTML = "";
    updateStudyHeader();
    if (item.type === "learn") {
      renderLearnCard(item);
    } else {
      const direction = quizDirection(item);
      if (direction === "self") renderSelfCheckCard(item);
      else renderQuizCard(item);
    }
  }

  function renderLearnCard(item) {
    const word = BY_ID.get(item.id);
    if (!word) {
      nextItem();
      return;
    }
    const rec = state.words[word.id];
    const strength = rec ? Math.round(rec.strength || 0) : 0;
    const strengthHTML = rec
      ? '<span class="strength-inline"><span class="mini-bar"><i style="width:' + strength + '%"></i></span>' +
        strength + "%</span>"
      : "";
    const exampleHTML = extractExample(word);
    const tipText = exampleHTML
      ? "先记住它，等会儿会有一道小题，检查你是否真的拾起来了。"
      : "这个词条来自 PDF 4 周计划词表，暂无例句；先把释义和词性记住。";
    const body = document.getElementById("studyBody");
    body.innerHTML =
      '<div class="study-card' + (exampleHTML ? "" : " no-example") + '" id="studyCard">' +
        '<div class="study-topline"><span class="study-kicker"><i class="dot"></i> 新词 · 第 ' +
        (session.newLearned + 1) + " 个</span>" +
        '<span class="study-tag">' + escapeHTML(word.group) + "</span></div>" +
        '<div class="word-hero"><h2 class="word-big">' + escapeHTML(word.word) + "</h2>" +
          '<div class="ipa-row"><span class="ipa-text">/' + escapeHTML(word.ipa) + "/</span>" +
          '<button class="speak-btn" data-action="speak" data-word="' + escapeHTML(word.word) + '" aria-label="朗读单词">' +
          icon("volume") + "</button>" + strengthHTML + "</div></div>" +
        '<div class="reveal-prompt" id="revealPrompt" data-action="reveal-learn" role="button" tabindex="0">' +
          icon("eye") + "<span>轻点显示释义</span><small>先在心里回想一下</small></div>" +
        '<div class="meaning-block is-hidden" id="meaningBlock">' +
          '<div class="meaning-rule">MEANING</div>' +
          '<p class="meaning-cn">' + escapeHTML(word.meaning) + "</p>" +
          exampleHTML +
          '<div class="study-tip">' + icon("brain") + "<span>" + tipText + "</span></div>" +
        "</div>" +
        '<div class="study-action-zone" id="studyActionZone">' +
          '<button class="btn btn-green btn-block" data-action="reveal-learn">显示释义' + icon("eye") + "</button>" +
        "</div>" +
      "</div>";

    if (state.settings.autoSpeak) {
      setTimeout(function () {
        if (session && !session.finished && currentItem() === item && !session.revealed) speak(word.word);
      }, 260);
    }
  }

  function revealStudyAction() {
    requestAnimationFrame(function () {
      const stage = document.getElementById("studyBody");
      const action = document.getElementById("studyActionZone");
      if (!stage || !action || !action.offsetHeight) return;
      const overflow = action.getBoundingClientRect().bottom - (stage.getBoundingClientRect().bottom - 12);
      if (overflow > 0) stage.scrollTop += overflow;
    });
  }

  function revealLearn() {
    if (!session || session.finished) return;
    const item = currentItem();
    if (!item || item.type !== "learn" || session.revealed) return;
    session.revealed = true;
    const prompt = document.getElementById("revealPrompt");
    const meaning = document.getElementById("meaningBlock");
    if (prompt) prompt.classList.add("is-hidden");
    if (meaning) meaning.classList.remove("is-hidden");
    document.getElementById("studyActionZone").innerHTML =
      '<div class="grade-row">' +
        '<button class="grade-btn" data-action="grade" data-grade="1"><b>不认识</b><span>从头再来</span></button>' +
        '<button class="grade-btn" data-action="grade" data-grade="3"><b>有点印象</b><span>稍后再考</span></button>' +
        '<button class="grade-btn" data-action="grade" data-grade="5"><b>记住了</b><span>明天再见</span></button>' +
      "</div>";
    revealStudyAction();
  }

  function randomQueueGap(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function enqueueCheck(id, source) {
    if (!session) return;
    const at = Math.min(session.index + randomQueueGap(2, 6), session.queue.length);
    session.queue.splice(at, 0, { type: "check", id: id, source: source || "new" });
  }

  function enqueueRepeat(id) {
    if (!session) return;
    const at = Math.min(session.index + randomQueueGap(2, 5), session.queue.length);
    session.queue.splice(at, 0, { type: "check", id: id, source: "repeat" });
  }

  function isSelfCheckItem(item) {
    if (!item || item.type === "learn") return false;
    if (item.direction) return item.direction === "self";
    const rec = state.words[item.id];
    return !!rec && Number(rec.repeatRequired) > 0 && Number(rec.repeatCorrect) >= 2;
  }

  function quizDirection(item) {
    if (item.direction) return item.direction;
    if (item.type !== "learn") {
      const rec = state.words[item.id];
      if (rec && Number(rec.repeatRequired) > 0) {
        const count = Number(rec.repeatCorrect) || 0;
        item.direction = count >= 2 ? "self" : (count === 1 ? "en2cn" : "cn2en");
        return item.direction;
      }
      if (item.type === "check") {
        session.checkSerial = (Number(session.checkSerial) || 0) + 1;
        const slot = session.checkSerial % 3;
        item.direction = slot === 1 ? "en2cn" : slot === 2 ? "cn2en" : "self";
        return item.direction;
      }
    }
    item.direction = "en2cn";
    return item.direction;
  }

  function gradeLearn(quality) {
    if (!session || session.finished || !session.revealed) return;
    const item = currentItem();
    if (!item || item.type !== "learn") return;
    const word = BY_ID.get(item.id);
    if (!word) return;
    const ms = performance.now() - session.itemStarted;
    applySchedule(word.id, quality, ms, "learn");
    const rec = ensureWordRecord(word.id);
    if (quality <= 1) {
      armRepeat(rec);
      enqueueCheck(word.id, "repeat");
    } else {
      enqueueCheck(word.id, "new");
    }
    session.revealed = false;
    session.answered += 1;
    session.newLearned += 1;
    session.learnedIds.push(word.id);
    const day = ensureToday();
    day.newIntroduced += 1;
    touchStreak();
    persist();
    updateChrome();
    nextItem();
  }

  function repeatDashesHTML(rec) {
    if (!rec || Number(rec.repeatRequired) <= 0) return "";
    return '<div class="repeat-dashes" role="img" aria-label="连续正确 ' +
      (Number(rec.repeatCorrect) || 0) + ' / 3">' +
      [0, 1, 2].map(function (index) {
        return '<i class="' + (index < (Number(rec.repeatCorrect) || 0) ? "is-done" : "") + '"></i>';
      }).join("") + "</div>";
  }

  function renderQuizCard(item) {
    const word = BY_ID.get(item.id);
    if (!word) {
      nextItem();
      return;
    }
    const rec = state.words[word.id];
    const count = optionCount();
    const direction = quizDirection(item);
    const isCn2En = direction === "cn2en";
    const options = buildOptions(word, count, isCn2En ? "word" : "meaning");
    session.options = options;
    const strength = rec ? Math.round(rec.strength || 0) : 0;
    const kickerText = item.source === "repeat"
      ? "巩固复习"
      : item.type === "check"
        ? "刚学过 · 加固"
        : (item.type === "mistake" ? "错词重练" : "到期复习");
    const kickerClass = item.type === "check" ? " is-check" : " is-review";
    const strengthHTML = rec
      ? '<span class="strength-inline"><span class="mini-bar"><i style="width:' + strength + '%"></i></span>' +
        strength + "%</span>"
      : "";
    const repeatDashes = repeatDashesHTML(rec);
    const wordHero = isCn2En
      ? '<div class="quiz-cn-hero"><span class="quiz-cn-label">中文释义</span>' +
        '<h2 class="quiz-cn-meaning">' + escapeHTML(word.meaning) + "</h2></div>"
      : '<div class="word-hero"><h2 class="word-big">' + escapeHTML(word.word) + "</h2>" +
        '<div class="ipa-row"><span class="ipa-text">/' + escapeHTML(word.ipa) + "/</span>" +
        '<button class="speak-btn" data-action="speak" data-word="' + escapeHTML(word.word) + '" aria-label="朗读单词">' +
        icon("volume") + "</button>" + strengthHTML + "</div></div>";
    const promptText = isCn2En ? "看中文选英文" : "看英文选释义";
    const optionsHTML = options.map(function (option, index) {
      return '<button class="option" data-action="option" data-index="' + index + '" data-id="' + option.id + '">' +
        '<span class="option-letter">' + "ABCDE"[index] + "</span><span>" + escapeHTML(option.text) + "</span></button>";
    }).join("");
    document.getElementById("studyBody").innerHTML =
      '<div class="study-card quiz-card" id="studyCard">' +
        '<div class="study-topline"><span class="study-kicker' + kickerClass + '"><i class="dot"></i> ' + kickerText + "</span>" +
        '<span class="study-tag">' + escapeHTML(word.group) + "</span></div>" +
        wordHero +
        repeatDashes +
        '<p class="quiz-prompt">' + promptText + " · " + count + " 选 1</p>" +
        '<div class="quiz-options" id="quizOptions">' + optionsHTML + "</div>" +
        '<div class="quiz-skip-row"><button class="text-link" data-action="option" data-index="-1">不认识，直接看答案</button></div>' +
        '<div id="quizFeedback"></div>' +
        '<div class="study-action-zone" id="studyActionZone"></div>' +
      "</div>";
  }

  function renderSelfCheckCard(item) {
    const word = BY_ID.get(item.id);
    if (!word) {
      nextItem();
      return;
    }
    const rec = state.words[word.id];
    const selfKicker = Number(rec && rec.repeatRequired) > 0 ? "巩固复习" : "刚学过 · 加固";
    const strength = rec ? Math.round(rec.strength || 0) : 0;
    const strengthHTML = rec
      ? '<span class="strength-inline"><span class="mini-bar"><i style="width:' + strength + '%"></i></span>' +
        strength + "%</span>"
      : "";
    document.getElementById("studyBody").innerHTML =
      '<div class="study-card self-check-card" id="studyCard">' +
        '<div class="study-topline"><span class="study-kicker is-check"><i class="dot"></i> ' + selfKicker + "</span>" +
        '<span class="study-tag">' + escapeHTML(word.group) + "</span></div>" +
        '<div class="word-hero"><h2 class="word-big">' + escapeHTML(word.word) + "</h2>" +
          '<div class="ipa-row"><span class="ipa-text">/' + escapeHTML(word.ipa) + "/</span>" +
          '<button class="speak-btn" data-action="speak" data-word="' + escapeHTML(word.word) + '" aria-label="朗读单词">' +
          icon("volume") + "</button>" + strengthHTML + "</div></div>" +
        repeatDashesHTML(rec) +
        '<div class="self-meaning-block is-hidden" id="selfMeaningBlock">' +
          '<div class="meaning-rule">MEANING</div>' +
          '<p class="meaning-cn">' + escapeHTML(word.meaning) + "</p>" +
          extractExample(word) +
        "</div>" +
        '<div id="selfFeedback"></div>' +
        '<div class="study-action-zone" id="studyActionZone">' +
          '<div class="self-choice-row" id="selfChoiceRow">' +
            '<button class="self-choice is-yes" data-action="self-know" data-know="1">知道</button>' +
            '<button class="self-choice is-no" data-action="self-know" data-know="0">不知道</button>' +
          "</div>" +
        "</div>" +
      "</div>";
    session.selfStage = "know";
    session.selfKnow = null;
    if (state.settings.autoSpeak) {
      setTimeout(function () {
        if (session && !session.finished && currentItem() === item && !session.quizAnswered) speak(word.word);
      }, 260);
    }
  }

  function selfKnow(value) {
    if (!session || session.finished || session.quizAnswered) return;
    const item = currentItem();
    if (!isSelfCheckItem(item) || session.selfStage !== "know") return;
    session.selfKnow = Number(value) === 1;
    session.selfStage = "verify";
    const block = document.getElementById("selfMeaningBlock");
    if (block) block.classList.remove("is-hidden");
    const row = document.getElementById("selfChoiceRow");
    if (row) {
      row.innerHTML =
        '<button class="self-choice is-yes" data-action="self-verify" data-correct="1">正确</button>' +
        '<button class="self-choice is-no" data-action="self-verify" data-correct="0">错误</button>';
    }
    revealStudyAction();
  }

  function feedbackHTML(word, correct, ms) {
    return '<div class="feedback">' +
      '<div class="feedback-head ' + (correct ? "ok" : "err") + '">' +
      icon(correct ? "check" : "x") + (correct ? "拾起来了" : "再看一眼") +
      '<span class="feedback-speed">' + formatSeconds(ms) + "s</span></div>" +
      '<p class="feedback-word"><span>单词</span><b>' + escapeHTML(word.word) + "</b><em>/" +
      escapeHTML(word.ipa) + "/</em>" +
      '<button class="mini-speak" data-action="speak" data-word="' + escapeHTML(word.word) + '" aria-label="朗读单词">' +
      icon("volume") + "</button></p>" +
      '<p class="feedback-meaning"><span>释义</span>' + escapeHTML(word.meaning) + "</p>" +
      extractExample(word) +
      "</div>";
  }

  function updateRepeatOnAnswer(id, correct) {
    const rec = ensureWordRecord(id);
    if (!correct) {
      armRepeat(rec);
      enqueueRepeat(id);
      return { reset: true, count: 0 };
    }
    if (Number(rec.repeatRequired) <= 0) return null;
    const next = Math.min(3, (Number(rec.repeatCorrect) || 0) + 1);
    rec.repeatCorrect = next;
    if (next >= 3) {
      completeRepeat(rec);
      return { done: true, count: 3 };
    }
    rec.due = Date.now();
    enqueueRepeat(id);
    return { pending: true, count: next };
  }

  function updateRepeatDashes(count) {
    const dashes = document.querySelectorAll(".repeat-dashes i");
    dashes.forEach(function (dash, index) {
      dash.classList.toggle("is-done", index < count);
    });
    const wrap = document.querySelector(".repeat-dashes");
    if (wrap) wrap.setAttribute("aria-label", "连续正确 " + count + " / 3");
  }

  function markGroupRemembered(id) {
    if (!session || !Array.isArray(session.groupIds) || !session.groupIds.includes(id)) return;
    if (session.groupRemembered.includes(id)) return;
    session.groupRemembered.push(id);
    updateStudyHeader();
  }

  function answerQuiz(index) {
    if (!session || session.finished || session.quizAnswered) return;
    const item = currentItem();
    if (!item || item.type === "learn") return;
    const word = BY_ID.get(item.id);
    if (!word) return;

    const ms = Math.max(320, performance.now() - session.itemStarted);
    const selected = index >= 0 && session.options ? session.options[index] : null;
    const correct = !!(selected && selected.id === word.id);
    const quality = qualityForQuiz(correct, ms);

    session.quizAnswered = true;
    applySchedule(word.id, quality, ms, item.type === "check" ? "check" : "quiz");
    const repeatState = updateRepeatOnAnswer(word.id, correct);
    if (repeatState) updateRepeatDashes(repeatState.count);
    if (correct && Number(ensureWordRecord(word.id).repeatRequired) === 0) {
      markGroupRemembered(word.id);
    }
    updateMetrics(correct, ms);
    session.answered += 1;
    session.reviewAnswered += 1;
    if (correct) {
      session.correct += 1;
      session.correctMs += ms;
    } else {
      session.wrongIds.push(word.id);
    }
    const day = ensureToday();
    day.reviews += 1;
    if (correct) {
      day.correct += 1;
      day.correctMs += ms;
    }
    day.totalMs += ms;
    touchStreak();
    persist();
    updateChrome();

    const optionNodes = document.querySelectorAll("#quizOptions .option");
    optionNodes.forEach(function (node) {
      node.classList.add("is-locked");
      if (node.dataset.id === word.id) node.classList.add("is-correct");
      else if (selected && node.dataset.id === selected.id) node.classList.add("is-wrong");
      else node.classList.add("is-dim");
    });

    const feedback = document.getElementById("quizFeedback");
    if (feedback) {
      feedback.innerHTML = feedbackHTML(word, correct, ms);
    }
    document.getElementById("studyActionZone").innerHTML =
      '<button class="study-next" data-action="next-item">' + (correct ? "继续" : "继续复习") + icon("arrow") + "</button>";
    revealStudyAction();

    playTone(correct ? "correct" : "wrong");
    haptic(correct ? 12 : [12, 40, 12]);
    session.lastResult = { correct: correct, ms: ms };
  }

  function finishSelfCheck(correct) {
    if (!session || session.finished || session.quizAnswered) return;
    const item = currentItem();
    if (!isSelfCheckItem(item) || session.selfStage !== "verify") return;
    const word = BY_ID.get(item.id);
    if (!word) return;

    const ms = Math.max(320, performance.now() - session.itemStarted);
    correct = !!correct;
    session.quizAnswered = true;
    applySchedule(word.id, correct ? qualityForQuiz(true, ms) : 1, ms, "check");
    const repeatState = updateRepeatOnAnswer(word.id, correct);
    if (repeatState) updateRepeatDashes(repeatState.count);
    if (correct && Number(ensureWordRecord(word.id).repeatRequired) === 0) {
      markGroupRemembered(word.id);
    }
    updateMetrics(correct, ms);
    session.answered += 1;
    session.reviewAnswered += 1;
    if (correct) {
      session.correct += 1;
      session.correctMs += ms;
    } else {
      session.wrongIds.push(word.id);
    }
    const day = ensureToday();
    day.reviews += 1;
    if (correct) {
      day.correct += 1;
      day.correctMs += ms;
    }
    day.totalMs += ms;
    touchStreak();
    persist();
    updateChrome();

    document.querySelectorAll("#selfChoiceRow .self-choice").forEach(function (button) {
      button.disabled = true;
    });
    const feedback = document.getElementById("selfFeedback");
    if (feedback) feedback.innerHTML = feedbackHTML(word, correct, ms);
    document.getElementById("studyActionZone").innerHTML =
      '<button class="study-next" data-action="next-item">' + (correct ? "继续" : "继续复习") + icon("arrow") + "</button>";
    revealStudyAction();

    playTone(correct ? "correct" : "wrong");
    haptic(correct ? 12 : [12, 40, 12]);
    session.lastResult = { correct: correct, ms: ms };
  }

  function nextItem() {
    if (!session || session.finished) return;
    const item = currentItem();
    if (!item) {
      finishSession();
      return;
    }
    if (item.type !== "learn" && !session.quizAnswered) return;
    session.index += 1;
    session.revealed = false;
    session.quizAnswered = false;
    if (session.index >= session.queue.length) {
      finishSession();
    } else {
      renderCurrent();
    }
  }

  function adaptPlan(stats, mode) {
    const profile = state.profile;
    const currentMode = studyMode();
    const beforeWords = Number(profile.newPerDay) || 18;
    const beforeChallenge = Number(profile.challenge) || 0.42;
    const beforeLevel = difficultyLevel();
    const enough = stats.reviewAnswered >= 5 && stats.accuracy != null;
    let afterWords = beforeWords;
    let delta = 0;
    let reason = "";
    let afterLevel = beforeLevel;

    if (enough) {
      const accuracy = stats.accuracy;
      const speed = stats.speedMs;
      if (currentMode === "auto") {
        if (mode !== "mistake") {
          if (accuracy >= 0.9 && speed && speed <= 2600) delta = 4;
          else if (accuracy >= 0.82 && speed && speed <= 4000) delta = 2;
          else if (accuracy < 0.6) delta = -5;
          else if (accuracy < 0.72) delta = -3;
          else if (speed && speed > 5200) delta = -1;
          afterWords = clamp(beforeWords + delta, 6, 36);
          profile.newPerDay = afterWords;
        }
      }

      const accuracyScore = clamp((accuracy - 0.62) / 0.33, 0, 1);
      const speedScore = speed ? clamp((4600 - speed) / 3000, 0, 1) : 0.5;
      const targetChallenge = 0.18 + accuracyScore * 0.5 + speedScore * 0.3;
      profile.challenge = clamp(beforeChallenge * 0.45 + targetChallenge * 0.55, 0.12, 0.94);
      afterLevel = difficultyLevel();

      const percent = formatPercent(accuracy);
      const seconds = speed ? formatSeconds(speed) + "s" : "--";
      if (currentMode === "manual") {
        reason = "手动词量固定为 " + beforeWords + " 词；这一组的表现让难度来到 " + afterLevel + "/5（" +
          difficultyLabel(afterLevel) + "）。";
      } else if (currentMode === "hybrid") {
        reason = "手动目标 " + beforeWords + " 词保持不变；达到目标后会询问是否继续，继续时按表现自动追加新词。";
      } else if (mode === "mistake") {
        reason = "错词重练只用来加固，不计入词量调整；难度现在是 " + afterLevel + "/5（" +
          difficultyLabel(afterLevel) + "）。";
      } else if (delta > 0) {
        reason = "正确率 " + percent + "，平均反应 " + seconds + "，又准又快。明天新词 " + beforeWords +
          " → " + afterWords + "，难度 " + afterLevel + "/5。";
      } else if (delta < 0) {
        reason = "本组有 " + (stats.reviewAnswered - stats.correct) + " 处混淆，平均反应 " + seconds +
          "。明天先把词量收到 " + afterWords + "，难度调到 " + afterLevel + "/5，拾稳再加速。";
      } else {
        reason = "正确率 " + percent + "，平均反应 " + seconds + "。节奏稳定，明天保持 " + afterWords +
          " 词，难度 " + afterLevel + "/5。";
      }
    } else {
      reason = "这一组的答题样本还少，词量与难度先保持，下一组会校准得更准。";
    }

    return {
      beforeWords: beforeWords,
      afterWords: afterWords,
      delta: delta,
      beforeLevel: beforeLevel,
      afterLevel: afterLevel,
      beforeChallenge: beforeChallenge,
      afterChallenge: Number(profile.challenge),
      enough: enough,
      reason: reason,
      accuracy: stats.accuracy,
      speedMs: stats.speedMs,
      mode: mode,
      studyMode: currentMode
    };
  }

  function finishSession() {
    if (!session || session.finished) return;
    session.finished = true;
    session.index = session.queue.length;
    const reviewAnswered = session.reviewAnswered;
    const accuracy = reviewAnswered ? session.correct / reviewAnswered : null;
    const speedMs = session.correct ? Math.round(session.correctMs / session.correct) : null;
    const stats = {
      newLearned: session.newLearned,
      reviewAnswered: reviewAnswered,
      correct: session.correct,
      accuracy: accuracy,
      speedMs: speedMs
    };
    const adapt = adaptPlan(stats, session.mode);
    const summary = {
      newLearned: session.newLearned,
      reviewAnswered: reviewAnswered,
      correct: session.correct,
      accuracy: accuracy,
      speedMs: speedMs,
      wrongIds: Array.from(new Set(session.wrongIds)),
      adapt: adapt,
      studyMode: adapt.studyMode,
      durationMs: Date.now() - session.startedAt,
      mode: session.mode
    };
    session.summary = summary;

    const day = ensureToday();
    const hybridPending = studyMode() === "hybrid" && !day.hybridStopped && learnedCount() < WORDS.length;
    day.completed = day.newIntroduced >= day.plan && dueList().length === 0 && !hybridPending;
    state.profile.sessions.push({
      at: Date.now(),
      date: dateKey(),
      newWords: summary.newLearned,
      reviews: summary.reviewAnswered,
      accuracy: summary.accuracy,
      speedMs: summary.speedMs,
      planAfter: state.profile.newPerDay
    });
    if (state.profile.sessions.length > 40) state.profile.sessions = state.profile.sessions.slice(-40);
    persist();
    updateStudyHeader();
    renderSummary();
    updateChrome();
    if (summary.accuracy != null && summary.accuracy >= 0.8) {
      confettiTimer = setTimeout(burstConfetti, 220);
    } else if (summary.newLearned >= 5) {
      confettiTimer = setTimeout(burstConfetti, 220);
    }
    const finishedSession = session;
    if (summary.studyMode === "hybrid") {
      setTimeout(function () {
        if (session === finishedSession && session.finished && currentView === "today" &&
            !document.getElementById("study").classList.contains("is-hidden")) {
          maybePromptHybridContinue(summary);
        }
      }, 700);
    }
  }

  function renderSummary() {
    if (!session || !session.summary) return;
    const summary = session.summary;
    const adapt = summary.adapt;
    const accuracy = summary.accuracy == null ? 0 : summary.accuracy;
    const percent = summary.accuracy == null ? "--" : formatPercent(summary.accuracy);
    const remaining = remainingToday();
    const canContinue = remaining.new > 0 || remaining.due > 0;
    const wrongCount = summary.wrongIds.length;
    let title;
    if (summary.mode === "mistake") title = "错词，又见面了。";
    else if (summary.accuracy == null) title = "这一组，先拾起来。";
    else if (summary.accuracy >= 0.9) title = "这一组，拾得很稳。";
    else if (summary.accuracy >= 0.75) title = "这一组，拾得不错。";
    else title = "这一组，把错的拾回来。";

    let continueHTML = "";
    if (canContinue) {
      const newPart = remaining.new ? Math.min(MAX_NEW_PER_SESSION, remaining.new) + " 个新词" : "";
      const duePart = remaining.due ? Math.min(MAX_REVIEW_PER_SESSION, remaining.due) + " 个复习" : "";
      const label = [newPart, duePart].filter(Boolean).join(" + ");
      continueHTML = '<button class="btn btn-green btn-block" data-action="start-mixed">继续下一组 · ' + label +
        icon("arrow") + "</button>";
    } else {
      continueHTML = '<button class="btn btn-green btn-block" data-action="go-today">回到今日' + icon("arrow") + "</button>";
    }

    const ringOffset = 289 * (1 - clamp(accuracy, 0, 1));
    const day = ensureToday();
    const targetWords = Number(state.profile.newPerDay) || 18;
    let adaptCardHTML;
    if (summary.studyMode === "auto") {
      adaptCardHTML = '<div class="adapt-card">' +
        '<div class="adapt-head">' + icon("brain") + " 记忆引擎已更新" +
        "<em>难度 " + adapt.beforeLevel + " → " + adapt.afterLevel + "</em></div>" +
        '<div class="adapt-change">' +
          '<div class="adapt-box"><b>' + adapt.beforeWords + "</b><span>明日词量</span></div>" +
          '<span class="adapt-arrow">' + icon("arrow") + "</span>" +
          '<div class="adapt-box after"><b>' + adapt.afterWords + "</b><span>调整后</span></div>" +
        "</div>" +
        '<p class="adapt-text">' + escapeHTML(adapt.reason) + "</p></div>";
    } else if (summary.studyMode === "hybrid") {
      adaptCardHTML = '<div class="adapt-card mode-adapt-card">' +
        '<div class="adapt-head">' + icon("target") + " 混合模式" +
        '<em>手动目标 + 自动追加</em></div>' +
        '<div class="adapt-change single">' +
          '<div class="adapt-box"><b>' + targetWords + "</b><span>手动目标</span></div>" +
          '<span class="adapt-arrow">' + icon("arrow") + "</span>" +
          '<div class="adapt-box after"><b>' + day.plan + "</b><span>今日计划</span></div>" +
        "</div>" +
        '<p class="adapt-text">' + escapeHTML(adapt.reason) + "</p></div>";
    } else {
      adaptCardHTML = '<div class="adapt-card mode-adapt-card">' +
        '<div class="adapt-head">' + icon("target") + " 手动模式" +
        "<em>词量保持不变</em></div>" +
        '<div class="adapt-change single">' +
          '<div class="adapt-box"><b>' + targetWords + "</b><span>固定词量</span></div>" +
        "</div>" +
        '<p class="adapt-text">' + escapeHTML(adapt.reason) + "</p></div>";
    }
    const durationText = summary.durationMs < 60000
      ? Math.max(1, Math.round(summary.durationMs / 1000)) + " 秒"
      : Math.max(1, Math.round(summary.durationMs / 60000)) + " 分钟";
    document.getElementById("studyBody").innerHTML =
      '<div class="summary-card">' +
        '<div class="summary-orbit"><svg class="ring" viewBox="0 0 100 100" aria-hidden="true">' +
          '<circle class="ring-bg" cx="50" cy="50" r="46"></circle>' +
          '<circle class="ring-fill" id="summaryRing" cx="50" cy="50" r="46" style="stroke-dashoffset:289"></circle>' +
        "</svg><div class=\"ring-core\"><strong>" + percent + "</strong><span>正确率</span></div></div>" +
        '<span class="summary-kicker">SESSION COMPLETE</span>' +
        '<h2 class="summary-title">' + title + "</h2>" +
        '<p class="summary-sub">新词 ' + summary.newLearned + " 个 · 复习 " + summary.reviewAnswered +
        " 个 · 本组用时 " + durationText + "。记忆引擎已更新。</p>" +
        '<div class="summary-stats">' +
          '<div class="summary-stat"><strong>' + summary.newLearned + "</strong><span>新词</span></div>" +
          '<div class="summary-stat"><strong>' + (summary.speedMs ? formatSeconds(summary.speedMs) + "s" : "--") +
          "</strong><span>平均反应</span></div>" +
          '<div class="summary-stat"><strong>' + remaining.new + "</strong><span>剩余新词</span></div>" +
        "</div>" +
        adaptCardHTML +
        '<div class="summary-actions">' + continueHTML +
          (wrongCount ? '<button class="btn btn-soft" data-action="start-mistakes">复习本组错词（' + wrongCount + "）</button>" : "") +
          '<button class="btn btn-ghost" data-action="summary-profile">查看记忆报告</button>' +
        "</div>" +
        (canContinue ? '<div class="summary-link-row"><button class="text-link" data-action="go-today">先回到今日</button></div>' : "") +
      "</div>";
    document.getElementById("studyFoot").innerHTML = "";
    const ring = document.getElementById("summaryRing");
    if (ring) {
      setTimeout(function () { ring.style.strokeDashoffset = String(ringOffset); }, 80);
    }
    const stage = document.getElementById("studyBody");
    if (stage) stage.scrollTop = 0;
  }

  function hybridBatchSize(summary) {
    let accuracy = summary && summary.accuracy != null ? summary.accuracy : null;
    let speed = summary && summary.speedMs ? summary.speedMs : null;
    if (accuracy == null) {
      const recent = getRecentStats(20);
      accuracy = recent.accuracy;
      speed = recent.speedMs;
    }
    if (accuracy == null) return 4;
    if (accuracy >= 0.9 && speed && speed <= 2600) return 6;
    if (accuracy >= 0.82) return 4;
    return 2;
  }

  function hybridReady() {
    const day = ensureToday();
    return studyMode() === "hybrid" && day.plan > 0 && day.newIntroduced >= day.plan &&
      !day.hybridStopped && learnedCount() < WORDS.length;
  }

  function openHybridPrompt(summary, force) {
    if (!hybridReady()) return false;
    const day = ensureToday();
    if (!force && day.hybridLastPromptPlan === day.plan) return false;
    const layer = document.getElementById("modalLayer");
    if (layer && !layer.classList.contains("is-hidden")) return false;
    const unseen = WORDS.length - learnedCount();
    const batch = Math.min(unseen, hybridBatchSize(summary));
    if (batch < 1) return false;
    day.hybridLastPromptPlan = day.plan;
    persist();
    const basis = summary && summary.accuracy != null
      ? "本组正确率 " + formatPercent(summary.accuracy)
      : "按最近表现";
    const promptTitle = day.hybridExtensions ? "这一轮也完成了" : "今天的手动目标完成了";
    openModal(
      '<div class="modal-head"><h3 class="modal-title">混合模式 · 目标完成</h3>' +
      '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon("close") + "</button></div>" +
      '<div class="confirm-body hybrid-prompt">' +
        '<div class="confirm-icon">' + icon("target") + "</div>" +
        '<span class="summary-kicker">HYBRID CHECKPOINT</span>' +
        "<h3>" + promptTitle + "</h3>" +
        "<p>你已经推进到 <b>" + day.plan + "</b> 个新词。要继续再拾一小批吗？</p>" +
        '<div class="hybrid-suggestion"><span>' + basis + "，建议再拾</span><strong>" + batch +
        "</strong><em>个新词</em></div>" +
        '<div class="confirm-actions">' +
          '<button class="btn btn-ghost" data-action="hybrid-stop">今天到这里</button>' +
          '<button class="btn btn-green" data-action="hybrid-continue" data-count="' + batch + '">继续 ' +
          batch + " 个新词" + icon("arrow") + "</button>" +
        "</div>" +
        '<p class="hybrid-foot">继续后按本组表现自动追加；选择“今天到这里”，今天就不再追加新词。</p>' +
      "</div>"
    );
    return true;
  }

  function maybePromptHybridContinue(summary) {
    if (!summary || summary.newLearned <= 0) return false;
    if (!hybridReady()) return false;
    const day = ensureToday();
    if (day.hybridLastPromptPlan === day.plan) return false;
    return openHybridPrompt(summary, false);
  }

  function continueHybrid(count) {
    if (!hybridReady()) {
      closeModal();
      return;
    }
    const day = ensureToday();
    const unseen = WORDS.length - learnedCount();
    const requested = Math.floor(Number(count)) || hybridBatchSize(null);
    const batch = Math.max(1, Math.min(unseen, requested));
    day.plan += batch;
    day.hybridExtensions += 1;
    day.hybridStopped = false;
    day.hybridLastPromptPlan = 0;
    day.completed = false;
    persist();
    closeModal();
    updateChrome();
    startSession("new");
  }

  function stopHybridToday() {
    const day = ensureToday();
    day.hybridStopped = true;
    day.hybridLastPromptPlan = day.plan;
    day.completed = day.newIntroduced >= day.plan && dueList().length === 0;
    persist();
    closeModal();
    updateChrome();
    if (currentView === "today") renderToday();
    toast("好，今天到这里");
  }

  function requestExitStudy() {
    if (!session) {
      closeStudy();
      return;
    }
    if (session.finished || session.answered === 0) {
      closeStudy();
      return;
    }
    openConfirm({
      eyebrow: "EXIT SESSION",
      title: "先休息一下？",
      text: "已经答过的词都会保存，但这一组不会计入自适应结算。下次回来，记忆引擎会从下一组重新校准。",
      confirmLabel: "保存并退出",
      onConfirm: closeStudy
    });
  }

  function closeStudy() {
    stopConfetti();
    if ("speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (error) { /* ignore */ }
    }
    document.getElementById("study").classList.add("is-hidden");
    session = null;
    unlockBody();
    refreshCurrentView();
  }

  /* =========================================================
     word detail / algorithm / data
     ========================================================= */

  function statusLabel(rec) {
    if (!rec) return "未学习";
    if (rec.due <= Date.now()) return "待复习";
    if (isMastered(rec)) return "已掌握";
    return "学习中";
  }

  function openWordModal(id) {
    const word = BY_ID.get(id);
    if (!word) return;
    const rec = state.words[id] || null;
    const status = statusLabel(rec);
    const strength = rec ? Math.round(rec.strength || 0) : 0;
    const exampleHTML = extractExample(word);
    const actions =
      '<button class="btn btn-soft" data-action="speak" data-word="' + escapeHTML(word.word) + '">' +
        icon("volume") + " 朗读</button>" +
      (rec && !isMastered(rec)
        ? '<button class="btn btn-green" data-action="mark-mastered" data-id="' + id + '">' + icon("check") + " 标为已掌握</button>"
        : "") +
      (rec
        ? '<button class="btn btn-ghost danger-text" data-action="reset-word" data-id="' + id + '">重置</button>'
        : '<button class="btn btn-ghost" data-action="close-modal">知道了</button>');

    openModal(
      '<div class="modal-head"><h3 class="modal-title">词条详情</h3>' +
      '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon("close") + "</button></div>" +
      '<div class="modal-body">' +
        '<div class="detail-word-row"><div><h2 class="detail-word">' + escapeHTML(word.word) + "</h2>" +
          '<div class="detail-ipa-row">/' + escapeHTML(word.ipa) + "/" +
          '<button class="speak-btn" data-action="speak" data-word="' + escapeHTML(word.word) + '" aria-label="朗读">' +
          icon("volume") + "</button></div></div></div>" +
        '<p class="detail-meaning">' + escapeHTML(word.meaning) + "</p>" +
        '<div class="detail-group">' + escapeHTML(word.group) + " · " + escapeHTML(word.groupIntro) + "</div>" +
        (exampleHTML || '<div class="study-tip">' + icon("info") + "<span>这个词条来自 PDF 词表，暂无例句；可以先记住释义和词性。</span></div>") +
        '<div class="schedule-grid">' +
          '<div class="schedule-item"><b>' + status + "</b><span>状态</span></div>" +
          '<div class="schedule-item"><b>' + (rec ? dueText(rec.due) : "—") + "</b><span>下次复习</span></div>" +
          '<div class="schedule-item"><b>' + (rec ? rec.checks : 0) + "</b><span>已作答</span></div>" +
        "</div>" +
        '<div class="strength-block"><div class="strength-block-head"><span>记忆强度</span><b>' + strength +
          '%</b></div><div class="strength-track"><i style="width:' + strength + '%"></i></div></div>' +
        '<div class="detail-actions">' + actions + "</div>" +
      "</div>"
    );
  }

  function showAlgorithm() {
    const stats = getRecentStats(40);
    const level = difficultyLevel();
    openModal(
      '<div class="modal-head"><h3 class="modal-title">记忆引擎</h3>' +
      '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon("close") + "</button></div>" +
      '<div class="modal-body algo-body">' +
        '<p class="panel-desc">拾词不按固定课表推进。它记录你每一次作答的正误与反应时间，再决定每个词什么时候回来、下一组有多难。</p>' +
        '<div class="algo-step"><h4>记录反应</h4><p>选择题记录对错与毫秒；新词卡记录你的自评。答得又快又准，说明这个词已经接近熟悉。</p></div>' +
        '<div class="algo-step"><h4>安排复习</h4><p>采用简化的 SM-2 间隔重复：答对后间隔从 1 天、3 天开始逐步拉长；答错则回到几分钟后，并在当天稍晚再次出现。</p></div>' +
        '<div class="algo-step"><h4>新词巩固</h4><p>每组最多 10 个新词。普通检查按看英文选释义、看中文选英文、只看单词自评三种方式轮换；需要三次巩固时，也依次使用这三种方式。自评卡先选“知道 / 不知道”，显示释义后再选“正确 / 错误”；选错误会让这个词重新进入三次循环。自评“不认识”或检查答错时，需要连续答对 3 次才算记住；中途答错会清零并重新累计。</p></div>' +
        '<div class="algo-step"><h4>调整难度</h4><p>正确率高、反应快时，难度上升，选项会从三选一变成四选一甚至五选一，并优先使用同词性的干扰项；状态下滑时自动退回更好起步的模式。</p></div>' +
        '<div class="algo-step"><h4>调整词量</h4><p>每组结算一次：正确率 ≥90% 且平均反应 ≤2.6 秒，次日词量 +4；正确率低于 60%，次日 -5；其余情况小幅增减。自动模式下每日词量在 6–36 之间；手动模式不设上限；混合模式先按手动目标推进，达到后询问是否继续，并按表现自动追加 2–6 个新词。</p></div>' +
        '<div class="algo-note">当前参数：' + studyModeLabel() + " · 每日 " + state.profile.newPerDay + " 词 · 难度 " + level + "/5 · " +
          optionCount() + " 个选项 · 近 " + stats.total + " 次正确率 " + formatPercent(stats.accuracy) + "。</div>" +
      "</div>"
    );
  }

  function exportData() {
    try {
      const payload = Object.assign({}, state, { exportedAt: new Date().toISOString() });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "shici-cet4-" + dateKey() + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 800);
      toast("备份已导出");
    } catch (error) {
      console.warn(error);
      toast("导出失败，请稍后再试");
    }
  }

  let pendingImport = null;

  function handleImportFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("文件太大，请选择拾词的备份文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || typeof data !== "object" || !data.words || !data.profile) {
          throw new Error("invalid");
        }
        pendingImport = normalizeState(data);
        openConfirm({
          eyebrow: "IMPORT BACKUP",
          title: "导入这份备份？",
          text: "导入会覆盖当前的学习记录、词量和设置。建议先导出当前数据留一份。",
          confirmLabel: "覆盖并导入",
          onConfirm: function () {
            state = pendingImport;
            pendingImport = null;
            persist();
            applyTheme();
            setView("today");
            updateChrome();
            toast("学习记录已导入");
          }
        });
      } catch (error) {
        toast("无法识别这个备份文件");
      }
    };
    reader.onerror = function () { toast("读取文件失败"); };
    reader.readAsText(file);
  }

  function resetEverything() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignore */ }
    state = blankState();
    session = null;
    document.getElementById("study").classList.add("is-hidden");
    applyTheme();
    setView("today");
    updateChrome();
    unlockBody();
    toast("学习记录已清空");
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme;
    let next;
    if (state.settings.theme === "auto") next = current === "dark" ? "light" : "dark";
    else if (state.settings.theme === "light") next = "dark";
    else next = "auto";
    state.settings.theme = next;
    applyTheme();
    persist();
    if (currentView === "settings") renderSettings();
    else updateChrome();
  }

  function setThemeMode(mode) {
    if (!["auto", "light", "dark"].includes(mode)) return;
    state.settings.theme = mode;
    applyTheme();
    persist();
    if (currentView === "settings") renderSettings();
    updateChrome();
  }

  function updateColorSettingsDOM() {
    const hex = normalizeHexColor(state.settings.themeColor) || DEFAULT_THEME_COLOR;
    const preset = presetForColor(hex);
    const name = preset ? preset.name : "自定义";
    const nameEl = document.getElementById("currentThemeName");
    if (nameEl) nameEl.textContent = name;
    const hexEl = document.getElementById("currentThemeHex");
    if (hexEl) hexEl.textContent = hex;
    const customValue = document.getElementById("customColorValue");
    if (customValue) customValue.textContent = hex;
    const customInput = document.getElementById("customColor");
    if (customInput && customInput.value !== hex) customInput.value = hex;
    const dot = document.getElementById("customColorDot");
    if (dot) dot.style.background = hex;
    const customLabel = document.querySelector(".custom-color");
    if (customLabel) customLabel.classList.toggle("is-active", !preset);
    document.querySelectorAll(".theme-swatch").forEach(function (button) {
      button.classList.toggle("is-active", normalizeHexColor(button.getAttribute("data-color")) === hex);
    });
  }

  function setThemeColor(color, options) {
    const hex = normalizeHexColor(color);
    if (!hex) return;
    state.settings.themeColor = hex;
    applyPalette();
    updateColorSettingsDOM();
    if (!options || options.persist !== false) persist();
    if (!options || options.render !== false) {
      if (currentView === "settings") renderSettings();
      updateChrome();
    }
  }

  function resetThemeColor() {
    state.settings.themeColor = DEFAULT_THEME_COLOR;
    applyTheme();
    persist();
    if (currentView === "settings") renderSettings();
    updateChrome();
    toast("已恢复默认主题色");
  }

  function updateGoalSettingsDOM() {
    const p = state.profile;
    const day = ensureToday();
    const mode = studyMode();
    const input = document.getElementById("dailyGoalInput");
    if (input && document.activeElement !== input) input.value = String(p.newPerDay);
    const autoGoal = document.getElementById("autoCurrentGoal");
    if (autoGoal) autoGoal.textContent = String(p.newPerDay);
    const hintEl = document.getElementById("dailyGoalHint");
    if (hintEl) {
      hintEl.textContent = mode === "hybrid"
        ? "先完成手动目标；达到后会询问是否继续，继续时按本组表现自动追加 2–6 个新词。"
        : "固定每日新词量；达到目标后今天不会追加，到期复习另行安排。";
    }
    document.querySelectorAll(".goal-presets .goal-choice").forEach(function (button) {
      button.classList.toggle("is-active", Number(button.getAttribute("data-value")) === p.newPerDay);
    });
    const todayEl = document.querySelector(".goal-today");
    if (todayEl) {
      todayEl.innerHTML = mode === "hybrid" && day.plan !== p.newPerDay
        ? "今天已学 <b>" + day.newIntroduced + "</b> / 手动目标 <b>" + p.newPerDay + "</b> · 今日计划 <b>" + day.plan + "</b>"
        : "今天已学 <b>" + day.newIntroduced + "</b> / 计划 <b>" + day.plan + "</b> 个新词";
    }
  }

  function setGoalLive(value, options) {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric) || numeric < 1) {
      updateGoalSettingsDOM();
      return;
    }
    const goal = numeric;
    state.profile.newPerDay = goal;
    const day = ensureToday();
    day.plan = Math.max(goal, day.newIntroduced);
    day.hybridStopped = false;
    day.hybridExtensions = 0;
    day.hybridLastPromptPlan = 0;
    day.completed = day.newIntroduced >= day.plan && dueList().length === 0;
    updateGoalSettingsDOM();
    updateChrome();
    if (!options || options.persist !== false) persist();
  }

  function setWordOrder(order) {
    if (!["sequential", "random"].includes(order)) return;
    state.profile.wordOrder = order;
    persist();
    document.querySelectorAll(".word-order-row .segment").forEach(function (button) {
      const active = button.getAttribute("data-order") === order;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setStudyMode(mode) {
    if (!STUDY_MODES[mode]) return;
    const p = state.profile;
    const day = ensureToday();
    p.studyMode = mode;
    if (mode === "auto") p.newPerDay = clamp(p.newPerDay, 6, 36);
    day.plan = Math.max(p.newPerDay, day.newIntroduced);
    day.hybridStopped = false;
    day.hybridExtensions = 0;
    day.hybridLastPromptPlan = 0;
    day.completed = day.newIntroduced >= day.plan && dueList().length === 0;
    persist();
    if (currentView === "settings") renderSettings();
    updateChrome();
    toast("已切换到" + STUDY_MODES[mode].label);
  }

  function commitDailyGoal() {
    const input = document.getElementById("dailyGoalInput");
    if (!input) return;
    const numeric = Math.floor(Number(input.value));
    if (!Number.isFinite(numeric) || numeric < 1) {
      input.value = String(state.profile.newPerDay);
      toast("请输入至少 1 个新词");
      return;
    }
    setGoalLive(numeric, { persist: true });
    input.value = String(state.profile.newPerDay);
  }

  function toggleSetting(key) {
    state.settings[key] = !state.settings[key];
    persist();
    if (currentView === "settings") renderSettings();
    else if (currentView === "profile") renderProfile();
    updateChrome();
  }

  function markMastered(id) {
    const rec = ensureWordRecord(id);
    rec.interval = 30;
    rec.reps = Math.max(3, rec.reps);
    rec.due = Date.now() + 30 * DAY;
    rec.ease = 2.6;
    rec.strength = 100;
    rec.repeatRequired = 0;
    rec.repeatCorrect = 0;
    rec.remembered = true;
    rec.rememberedAt = Date.now();
    rec.lastSeen = Date.now();
    persist();
    closeModal();
    refreshCurrentView();
    toast("已标记为掌握，30 天后再见");
  }

  function requestResetWord(id) {
    const word = BY_ID.get(id);
    openConfirm({
      eyebrow: "RESET WORD",
      title: "重置“" + (word ? word.word : "这个词") + "”？",
      text: "它会回到未学习状态，记忆强度和复习安排都会清空。明天可以重新学它。",
      confirmLabel: "确认重置",
      danger: true,
      onConfirm: function () {
        delete state.words[id];
        persist();
        refreshCurrentView();
        toast("已重置这个词");
      }
    });
  }

  /* =========================================================
     interactions
     ========================================================= */

  function handleKeydown(event) {
    const tag = (event.target && event.target.tagName) || "";
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag);

    if (event.key === "Escape") {
      const modalOpen = !document.getElementById("modalLayer").classList.contains("is-hidden");
      if (modalOpen) {
        closeModal();
        event.preventDefault();
        return;
      }
      if (session) {
        requestExitStudy();
        event.preventDefault();
        return;
      }
    }

    const modalOpen = !document.getElementById("modalLayer").classList.contains("is-hidden");
    if (modalOpen) return;

    if (session) {
      if (!session.finished) {
        const item = currentItem();
        if (!item) return;
        if (item.type === "learn") {
          if (!session.revealed && (event.key === " " || event.key === "Enter")) {
            event.preventDefault();
            revealLearn();
            return;
          }
          if (session.revealed && ["1", "2", "3"].includes(event.key)) {
            event.preventDefault();
            gradeLearn({ "1": 1, "2": 3, "3": 5 }[event.key]);
            return;
          }
        } else {
          if (isSelfCheckItem(item)) {
            if (session.quizAnswered && (event.key === " " || event.key === "Enter")) {
              event.preventDefault();
              nextItem();
              return;
            }
            if (!session.quizAnswered && ["1", "2"].includes(event.key)) {
              event.preventDefault();
              if (session.selfStage === "know") selfKnow(event.key === "1" ? 1 : 0);
              else if (session.selfStage === "verify") finishSelfCheck(event.key === "1");
              return;
            }
            return;
          }
          if (!session.quizAnswered && /^[a-eA-E]$/.test(event.key)) {
            const index = "abcde".indexOf(event.key.toLowerCase());
            if (index >= 0 && session.options && index < session.options.length) {
              event.preventDefault();
              answerQuiz(index);
              return;
            }
          }
          if (!session.quizAnswered && /^[1-5]$/.test(event.key)) {
            const index = Number(event.key) - 1;
            if (session.options && index < session.options.length) {
              event.preventDefault();
              answerQuiz(index);
              return;
            }
          }
          if (session.quizAnswered && (event.key === " " || event.key === "Enter")) {
            event.preventDefault();
            nextItem();
            return;
          }
        }
      }
      return;
    }

    if (event.target.id === "pageJump" && event.key === "Enter") {
      event.preventDefault();
      goToLibraryPage(event.target.value);
      return;
    }

    if (event.target.id === "dailyGoalInput" && event.key === "Enter") {
      event.preventDefault();
      commitDailyGoal();
      event.target.blur();
      return;
    }

    if (!typing && event.key === "/" && currentView === "library") {
      event.preventDefault();
      const input = document.getElementById("searchInput");
      if (input) input.focus();
      return;
    }

    if (!typing && (event.key === "Enter" || event.key === " ")) {
      const row = event.target.closest && event.target.closest(".word-row[data-action='open-word']");
      if (row && !event.target.closest("button, a, input, textarea, select")) {
        event.preventDefault();
        openWordModal(row.dataset.id);
      }
    }
  }

  function handleClick(event) {
    const backdrop = event.target.closest("[data-close-modal]");
    if (backdrop) {
      closeModal();
      return;
    }

    if (event.target.closest("#themeBtn")) {
      toggleTheme();
      return;
    }
    if (event.target.closest("#studyClose")) {
      requestExitStudy();
      return;
    }
    if (event.target.closest("#studySound")) {
      state.settings.autoSpeak = !state.settings.autoSpeak;
      persist();
      updateStudyHeader();
      toast(state.settings.autoSpeak ? "已开启自动发音" : "已关闭自动发音");
      return;
    }

    const nav = event.target.closest("[data-nav]");
    if (nav) {
      const name = nav.getAttribute("data-nav");
      if (name) setView(name);
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.getAttribute("data-action");

    switch (action) {
      case "reveal-learn":
        revealLearn();
        break;
      case "grade":
        gradeLearn(Number(actionEl.getAttribute("data-grade")));
        break;
      case "self-know":
        selfKnow(Number(actionEl.getAttribute("data-know")));
        break;
      case "self-verify":
        finishSelfCheck(actionEl.getAttribute("data-correct") === "1");
        break;
      case "option":
        answerQuiz(Number(actionEl.getAttribute("data-index")));
        break;
      case "next-item":
        nextItem();
        break;
      case "start-mixed":
        startSession("mixed");
        break;
      case "start-review":
        startSession("review");
        break;
      case "start-hard":
        startMistakeSession(hardList().slice(0, 20).map(function (entry) { return entry.word.id; }));
        break;
      case "start-mistakes":
        startMistakeSession(session && session.summary ? session.summary.wrongIds : []);
        break;
      case "open-profile":
        setView("profile");
        break;
      case "summary-profile":
        closeStudy();
        setView("profile");
        break;
      case "go-today":
        closeStudy();
        setView("today");
        break;
      case "prompt-hybrid":
        openHybridPrompt(null, true);
        break;
      case "hybrid-continue":
        continueHybrid(Number(actionEl.getAttribute("data-count")));
        break;
      case "hybrid-stop":
        stopHybridToday();
        break;
      case "review-tab":
        reviewTab = actionEl.getAttribute("data-tab") === "hard" ? "hard" : "due";
        renderReview();
        break;
      case "filter":
        libState.filter = actionEl.getAttribute("data-filter") || "all";
        libState.page = 1;
        renderLibrary();
        break;
      case "clear-search":
        libState.query = "";
        libState.page = 1;
        renderLibrary();
        setTimeout(function () {
          const input = document.getElementById("searchInput");
          if (input) input.focus();
        }, 20);
        break;
      case "lib-page":
        goToLibraryPage(actionEl.getAttribute("data-page"));
        break;
      case "lib-page-jump": {
        const pageInput = document.getElementById("pageJump");
        goToLibraryPage(pageInput ? pageInput.value : 1);
        break;
      }
      case "open-word":
        openWordModal(actionEl.getAttribute("data-id"));
        break;
      case "speak":
        speak(actionEl.getAttribute("data-word") || "");
        break;
      case "mark-mastered":
        markMastered(actionEl.getAttribute("data-id"));
        break;
      case "reset-word":
        requestResetWord(actionEl.getAttribute("data-id"));
        break;
      case "show-algo":
        showAlgorithm();
        break;
      case "set-theme-mode":
        setThemeMode(actionEl.getAttribute("data-mode"));
        break;
      case "set-theme-color":
        setThemeColor(actionEl.getAttribute("data-color"), { persist: true });
        break;
      case "reset-theme-color":
        resetThemeColor();
        break;
      case "adjust-goal": {
        const delta = Number(actionEl.getAttribute("data-delta")) || 0;
        setGoalLive(state.profile.newPerDay + delta, { persist: true });
        break;
      }
      case "theme":
        toggleTheme();
        break;
      case "toggle-setting":
        toggleSetting(actionEl.getAttribute("data-key"));
        break;
      case "set-goal":
        setGoalLive(actionEl.getAttribute("data-value"), { persist: true });
        break;
      case "set-word-order":
        setWordOrder(actionEl.getAttribute("data-order"));
        break;
      case "export":
        exportData();
        break;
      case "import":
        document.getElementById("importFile").click();
        break;
      case "reset":
        openConfirm({
          eyebrow: "RESET EVERYTHING",
          title: "清空全部学习记录？",
          text: "词库本身不会消失，但所有学习进度、记忆曲线和设置都会删除。这个动作无法撤销。",
          confirmLabel: "清空全部",
          danger: true,
          onConfirm: resetEverything
        });
        break;
      case "close-modal":
        closeModal();
        break;
      case "modal-confirm":
        runModalConfirm();
        break;
      default:
        break;
    }
  }

  function handleInput(event) {
    if (event.target.id === "searchInput") {
      libState.query = event.target.value;
      libState.page = 1;
      renderLibraryList();
      const clear = document.getElementById("searchClear");
      if (clear) clear.classList.toggle("show", !!libState.query);
      return;
    }
    if (event.target.id === "customColor") {
      setThemeColor(event.target.value, { persist: false, render: false });
      return;
    }
  }

  function handleChange(event) {
    if (event.target.id === "studyModeSelect") {
      setStudyMode(event.target.value);
      return;
    }
    if (event.target.id === "customColor") {
      persist();
      return;
    }
    if (event.target.id === "dailyGoalInput") {
      commitDailyGoal();
    }
  }

  function init() {
    applyTheme();
    loadVoices();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.id = "importFile";
    input.accept = "application/json,.json";
    input.hidden = true;
    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      handleImportFile(file);
      input.value = "";
    });
    document.body.appendChild(input);

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("input", handleInput);
    document.addEventListener("change", handleChange);

    if (window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = function () {
        if (state.settings.theme === "auto") applyTheme();
      };
      if (media.addEventListener) media.addEventListener("change", onChange);
      else if (media.addListener) media.addListener(onChange);
    }

    window.addEventListener("beforeunload", function () {
      if (state) persist();
    });

    setView("today", { scroll: false });
    updateChrome();
  }

  init();

})();
