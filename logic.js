/**
 * たんいドリル 出題ロジック（DOM に触れない純関数だけ）。
 * ブラウザでは window.TaniLogic、node では module.exports に公開する。
 */
(function (root) {
  "use strict";

  // ---- 定数 ----
  var STORAGE_KEY = "taniDrill_v1";
  var BACKUP_KEY_PREFIX = "taniDrill_v1_backup_";
  var STATE_VERSION = 1;
  var DAILY_COUNT = 10; // 1日に出す問題数
  var REVIEW_MAX = 5; // 復習枠の上限
  var MAX_TRIES = 3; // 同じ問題をその回に出す最大回数（初回を含む）
  var REQUEUE_OFFSET = 2; // 入れ直すときにはさむ問題数
  var INTERVALS = [2, 4, 8, 16]; // 習得後の復習間隔（日）
  var MAX_LEVEL = INTERVALS.length - 1;
  var RECORD_DAYS = 14; // きろくコピーの対象日数
  var NOTICE_CORRUPT = "corrupt";

  // ---- 日付（タイムゾーンでずれないよう UTC で計算） ----

  /** 日付文字列 YYYY-MM-DD に n 日を足した日付文字列を返す。 */
  function addDays(dateStr, n) {
    var p = dateStr.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  }

  /** 端末のローカル日付を YYYY-MM-DD で返す。 */
  function localDateString(date) {
    var d = date || new Date();
    var pad = function (v) {
      return (v < 10 ? "0" : "") + v;
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ---- 状態の生成・変換 ----

  /** 初回状態を返す。 */
  function emptyState() {
    return { version: STATE_VERSION, items: {}, days: {} };
  }

  /** 1問ぶんの初期記録を返す。 */
  function newItem() {
    return {
      streak: 0,
      mastered: false,
      level: 0,
      due: null,
      wrongPending: false,
      lastCorrectDate: null,
      wrongCount: 0,
    };
  }

  /** 状態を保存用の文字列にする。 */
  function serializeState(state) {
    return JSON.stringify(state);
  }

  /** 読み込めなかったときの返り値（初回状態＋通知＋退避）を作る。 */
  function corruptResult(raw, today) {
    return {
      state: emptyState(),
      notice: NOTICE_CORRUPT,
      backup: { key: BACKUP_KEY_PREFIX + today, value: raw },
    };
  }

  /** 値がプレーンなオブジェクトか。 */
  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /**
   * 保存文字列を状態に変換する。
   * 戻り値: { state, notice?, backup? }
   */
  function parseState(raw, today) {
    if (raw === null || raw === undefined) {
      return { state: emptyState() };
    }
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return corruptResult(raw, today);
    }
    if (!isPlainObject(obj)) {
      return corruptResult(raw, today);
    }
    if (obj.version === undefined && isPlainObject(obj.items)) {
      // 版0 からの移行
      obj.version = STATE_VERSION;
      obj.days = isPlainObject(obj.days) ? obj.days : {};
      return { state: obj };
    }
    var ok =
      obj.version === STATE_VERSION && isPlainObject(obj.items) && isPlainObject(obj.days);
    return ok ? { state: obj } : corruptResult(raw, today);
  }

  // ---- 採点 ----

  /** 数字文字列を正規化する。不正なら null。 */
  function normalizeNumber(text) {
    var s = String(text).trim();
    if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
    var parts = s.split(".");
    var intPart = parts[0].replace(/^0+/, "") || "0";
    var frac = (parts[1] || "").replace(/0+$/, "");
    return frac ? intPart + "." + frac : intPart;
  }

  /** 回答が正解か。number は数値として、choice は完全一致で比べる。 */
  function isCorrect(problem, given) {
    if (problem.type === "number") {
      var a = normalizeNumber(given);
      var b = normalizeNumber(problem.answer);
      return a !== null && b !== null && a === b;
    }
    return given === problem.answer;
  }

  // ---- 出題の組み立て ----

  /** 未出題（due が null か記録なし）の問題を stage 順・配列順で返す。 */
  function unservedProblems(problems, state) {
    return problems
      .map(function (p, i) {
        return { p: p, i: i };
      })
      .filter(function (x) {
        var it = state.items[x.p.id];
        return !it || it.due === null;
      })
      .sort(function (a, b) {
        return a.p.stage - b.p.stage || a.i - b.i;
      })
      .map(function (x) {
        return x.p.id;
      });
  }

  /** due の古い順、同じなら id 順に比べる。 */
  function byDueThenId(state) {
    return function (a, b) {
      var da = state.items[a].due;
      var db = state.items[b].due;
      if (da !== db) return da < db ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    };
  }

  /** 復習候補（wrongPending → 期限が来たもの）を優先順に返す。 */
  function reviewCandidates(problems, state, today) {
    var ids = problems
      .map(function (p) {
        return p.id;
      })
      .filter(function (id) {
        return state.items[id] && state.items[id].due !== null;
      });
    var wrong = ids
      .filter(function (id) {
        return state.items[id].wrongPending;
      })
      .sort(byDueThenId(state));
    var due = ids
      .filter(function (id) {
        var it = state.items[id];
        return !it.wrongPending && it.due <= today;
      })
      .sort(byDueThenId(state));
    return wrong.concat(due);
  }

  /** 未出題が無いときの出題: 全問から due の近い順に DAILY_COUNT 問。 */
  function allServedSet(problems, state) {
    return problems
      .map(function (p) {
        return p.id;
      })
      .sort(byDueThenId(state))
      .slice(0, DAILY_COUNT);
  }

  /** その日の出題 id 配列を作る。 */
  function buildDailySet(problems, state, today) {
    var fresh = unservedProblems(problems, state);
    if (fresh.length === 0) return allServedSet(problems, state);
    var candidates = reviewCandidates(problems, state, today);
    var review = candidates.slice(0, REVIEW_MAX);
    var overflow = candidates.slice(REVIEW_MAX);
    var picked = review.concat(fresh.slice(0, DAILY_COUNT - review.length));
    var shortage = DAILY_COUNT - picked.length;
    return shortage > 0 ? picked.concat(overflow.slice(0, shortage)) : picked;
  }

  // ---- 1回の出題セッション ----

  /** 出題 id 配列からセッションを開始する。 */
  function startSession(ids) {
    return { queue: ids.slice(), attempts: {} };
  }

  /** いま出す問題の id（無ければ null）。 */
  function currentId(session) {
    return session.queue.length ? session.queue[0] : null;
  }

  /** セッションが終わったか。 */
  function isFinished(session) {
    return session.queue.length === 0;
  }

  // ---- 1回目の結果の記録 ----

  /** days[today] を取得（なければ作る）。 */
  function dayRecord(state, today) {
    if (!state.days[today]) {
      state.days[today] = { served: [], firstCorrect: [], firstWrong: [] };
    }
    return state.days[today];
  }

  /** その日すでに1回目の結果が記録済みか。 */
  function hasFirstResult(state, today, id) {
    var d = state.days[today];
    return !!d && (d.firstCorrect.indexOf(id) >= 0 || d.firstWrong.indexOf(id) >= 0);
  }

  /** 1回目が間違いのときの記録更新。 */
  function applyFirstWrong(item, today) {
    item.streak = 0;
    item.mastered = false;
    item.level = 0;
    item.wrongPending = true;
    item.due = addDays(today, 1);
    item.wrongCount += 1;
  }

  /** 習得済みになった後、または到達した瞬間の間隔を設定する。 */
  function applyMasteredInterval(item, today) {
    if (item.mastered) {
      item.level = Math.min(item.level + 1, MAX_LEVEL);
    } else {
      item.mastered = true;
      item.level = 0;
    }
    item.due = addDays(today, INTERVALS[item.level]);
  }

  /** 1回目が正解のときの記録更新。 */
  function applyFirstCorrect(item, today) {
    item.wrongPending = false;
    if (item.streak === 0) {
      item.streak = 1;
      item.due = addDays(today, 1);
      item.lastCorrectDate = today;
      return;
    }
    if (item.lastCorrectDate === today) return; // 同じ日は増やさない
    item.streak += 1;
    item.lastCorrectDate = today;
    applyMasteredInterval(item, today);
  }

  /**
   * 1回目の結果を items と days に記録する（その日すでに記録済みなら何もしない）。
   * 戻り値: 記録したら true。
   */
  function recordFirstResult(state, id, correct, today) {
    if (hasFirstResult(state, today, id)) return false;
    var item = state.items[id] || (state.items[id] = newItem());
    var day = dayRecord(state, today);
    if (day.served.indexOf(id) < 0) day.served.push(id);
    if (correct) {
      applyFirstCorrect(item, today);
      day.firstCorrect.push(id);
    } else {
      applyFirstWrong(item, today);
      day.firstWrong.push(id);
    }
    return true;
  }

  /** 間違えた問題を、2問はさんだ後（残りが少なければ末尾）に入れ直す。 */
  function requeue(session, id) {
    var pos = Math.min(REQUEUE_OFFSET, session.queue.length);
    session.queue.splice(pos, 0, id);
  }

  /**
   * いまの問題に回答する。
   * 戻り値: { id, correct, first（その日の1回目として記録したか）, requeued }
   */
  function submitAnswer(session, problem, given, state, today) {
    var id = session.queue.shift();
    var correct = isCorrect(problem, given);
    session.attempts[id] = (session.attempts[id] || 0) + 1;
    var first = recordFirstResult(state, id, correct, today);
    var requeued = !correct && session.attempts[id] < MAX_TRIES;
    if (requeued) requeue(session, id);
    return { id: id, correct: correct, first: first, requeued: requeued };
  }

  // ---- きろくコピー ----

  /** 直近 RECORD_DAYS 日分を新しい日付順のテキストにする。 */
  function formatRecords(state, problems, today) {
    var promptOf = {};
    problems.forEach(function (p) {
      promptOf[p.id] = p.prompt;
    });
    var oldest = addDays(today, -(RECORD_DAYS - 1));
    var dates = Object.keys(state.days)
      .filter(function (d) {
        return d >= oldest && d <= today;
      })
      .sort()
      .reverse();
    return dates
      .map(function (d) {
        var day = state.days[d];
        var lines = [
          d + " / 出した問題数 " + day.served.length + " / 1回目で正解 " + day.firstCorrect.length,
        ];
        day.firstWrong.forEach(function (id) {
          lines.push("  まちがい: " + (promptOf[id] || id));
        });
        return lines.join("\n");
      })
      .join("\n");
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    addDays: addDays,
    localDateString: localDateString,
    emptyState: emptyState,
    serializeState: serializeState,
    parseState: parseState,
    normalizeNumber: normalizeNumber,
    isCorrect: isCorrect,
    buildDailySet: buildDailySet,
    startSession: startSession,
    currentId: currentId,
    isFinished: isFinished,
    submitAnswer: submitAnswer,
    recordFirstResult: recordFirstResult,
    formatRecords: formatRecords,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TaniLogic = api;
  }
})(typeof window !== "undefined" ? window : this);
