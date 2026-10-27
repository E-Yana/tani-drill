/**
 * たんいドリル 出題ロジック（DOM に触れない純関数だけ）。
 * ブラウザでは window.TaniLogic、node では module.exports に公開する。
 */
(function (root) {
  "use strict";

  // ---- 定数 ----
  var STORAGE_KEY = "taniDrill_v1";
  var BACKUP_KEY_PREFIX = "taniDrill_v1_backup_"; // 壊れデータの退避専用（刈り込まない）
  var RESTORE_KEY_PREFIX = "taniDrill_v1_restore_"; // 復元前の退避専用（新しい2本だけ残す）
  var STATE_VERSION = 1;
  var DAILY_COUNT = 10; // 1日に出す問題数
  var REVIEW_MAX = 5; // 復習枠の上限
  var BRAKE_WRONG = 5; // 間違えたまま（wrongPending）がこの数以上の日は新しい問題を出さない
  var BRAKE_WRONG_SLOTS = 7; // ブレーキ日に間違えたものへ割く最大枠（残りは正解できるものを混ぜる）
  var HARD_WRONG_MIN = 3; // 「固い苦手」とみなす間違い回数
  var HARD_WRONG_MAX = 2; // 固い苦手を先頭に置く最大数
  var BRAKE_EASY_BETWEEN_COUNT = 2; // ブレーキ日、固い苦手の前と間に置く easy の数
  var BRAKE_EASY_LAST_MIN = 3; // easy がこの数以上なら最後の1つを末尾に置く
  var MAX_TRIES = 3; // 同じ問題をその回に出す最大回数（初回を含む）
  var REQUEUE_OFFSET = 2; // 入れ直すときにはさむ問題数
  var INTERVALS = [2, 4, 8, 16]; // 習得後の復習間隔（日）
  var MAX_LEVEL = INTERVALS.length - 1;
  var RECORD_DAYS = 14; // バックアップ要約（直近の日別記録）の対象日数
  var NOTICE_CORRUPT = "corrupt";
  var BACKUP_APP_ID = "tani-drill";
  var BACKUP_FORMAT = 1;
  var WEAK_TOP_N = 10; // バックアップ要約に載せる苦手の件数
  var BACKUP_KEEP = 2; // 置換前の退避キーを残す本数（新しい順）
  var ARCHIVE_FIRST_SUFFIX = 2; // 同じ日の2本目の退避キーに付ける番号（_2, _3…）
  var ARCHIVE_SUFFIX_SEP = "_";
  // まちがえた答えの記録の件数上限（容量の安全網。14日分は必ず入る）
  var MISTAKE_LOG_MAX = RECORD_DAYS * DAILY_COUNT * MAX_TRIES;

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

  /** 固い苦手を回数の多い順（同数は期限→id）に並べる比較関数。 */
  function byWrongCountDesc(state) {
    var tie = byDueThenId(state);
    return function (a, b) {
      var d = state.items[b].wrongCount - state.items[a].wrongCount;
      return d !== 0 ? d : tie(a, b);
    };
  }

  /**
   * 間違えたまま（wrongPending）の並び。
   * 固い苦手（wrongCount>=HARD_WRONG_MIN）を回数の多い順に最大 HARD_WRONG_MAX 問先頭へ、
   * 続けて残りを期限の古い順→id で並べる。
   */
  function orderWrong(wrongIds, state) {
    var hard = wrongIds
      .filter(function (id) {
        return state.items[id].wrongCount >= HARD_WRONG_MIN;
      })
      .sort(byWrongCountDesc(state))
      .slice(0, HARD_WRONG_MAX);
    var rest = wrongIds
      .filter(function (id) {
        return hard.indexOf(id) < 0;
      })
      .sort(byDueThenId(state));
    return hard.concat(rest);
  }

  /** 復習候補を { wrong: 間違えたもの(並び済み), due: 期限が来たもの } に分けて返す。 */
  function reviewGroups(problems, state, today) {
    var ids = problems
      .map(function (p) {
        return p.id;
      })
      .filter(function (id) {
        return state.items[id] && state.items[id].due !== null;
      });
    var wrong = orderWrong(
      ids.filter(function (id) {
        return state.items[id].wrongPending;
      }),
      state
    );
    var due = ids
      .filter(function (id) {
        var it = state.items[id];
        return !it.wrongPending && it.due <= today;
      })
      .sort(byDueThenId(state));
    return { wrong: wrong, due: due };
  }

  /** 復習候補（wrongPending → 期限が来たもの）を優先順に返す。 */
  function reviewCandidates(problems, state, today) {
    var g = reviewGroups(problems, state, today);
    return g.wrong.concat(g.due);
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

  /** 出題集合を { easy: 正解できるもの, hard: 固い苦手, rest: 残りの間違い, fresh: 新問 } に分ける（各々は元の並びを保つ）。 */
  function splitBrakeKinds(picked, state) {
    var wrong = picked.filter(function (id) {
      return state.items[id] && state.items[id].wrongPending;
    });
    var hard = wrong
      .filter(function (id) {
        return state.items[id].wrongCount >= HARD_WRONG_MIN;
      })
      .slice(0, HARD_WRONG_MAX);
    return {
      easy: picked.filter(function (id) {
        return state.items[id] && !state.items[id].wrongPending;
      }),
      hard: hard,
      rest: wrong.filter(function (id) {
        return hard.indexOf(id) < 0;
      }),
      fresh: picked.filter(function (id) {
        return !state.items[id];
      }),
    };
  }

  /**
   * ブレーキ日の並べ替え（選ぶ集合は変えない）:
   * easy1つ目 → 固い苦手1 → easy2つ目 → 固い苦手2 → 残りの間違い → easyの残り → 最後に easy の最後の1つ。
   * easy や固い苦手が足りなければ、ある分だけ優先順に置いて無い位置は詰める。
   */
  function orderBrakeDay(picked, state) {
    var k = splitBrakeKinds(picked, state);
    var last = k.easy.length >= BRAKE_EASY_LAST_MIN ? k.easy.slice(-1) : [];
    var middle = k.easy.slice(BRAKE_EASY_BETWEEN_COUNT, last.length ? -1 : undefined);
    var out = [];
    k.hard.forEach(function (id, i) {
      if (k.easy[i] !== undefined && i < BRAKE_EASY_BETWEEN_COUNT) out.push(k.easy[i]);
      out.push(id);
    });
    // 固い苦手が0〜1問でも、先頭と間に置くはずだった easy は消さずに先頭側へ詰める
    for (var i = k.hard.length; i < BRAKE_EASY_BETWEEN_COUNT && i < k.easy.length; i++) out.push(k.easy[i]);
    return out.concat(k.rest, middle, k.fresh, last);
  }

  /**
   * ブレーキ日の出題: 間違い最大 BRAKE_WRONG_SLOTS 問 → 期限が来た正解済みもの →
   * 足りない時だけ残りの間違い → 最後に新問。新しい問題は最後まで足りない時だけ。
   * 集合を決めてから orderBrakeDay で並べ替える。
   */
  function brakeSet(groups, fresh, state) {
    var picked = groups.wrong.slice(0, BRAKE_WRONG_SLOTS);
    picked = picked.concat(groups.due.slice(0, DAILY_COUNT - picked.length));
    picked = picked.concat(groups.wrong.slice(BRAKE_WRONG_SLOTS, BRAKE_WRONG_SLOTS + DAILY_COUNT - picked.length));
    picked = picked.concat(fresh.slice(0, DAILY_COUNT - picked.length));
    return orderBrakeDay(picked, state);
  }

  /** その日の出題 id 配列を作る。 */
  function buildDailySet(problems, state, today) {
    var fresh = unservedProblems(problems, state);
    if (fresh.length === 0) return allServedSet(problems, state);
    var groups = reviewGroups(problems, state, today);
    if (groups.wrong.length >= BRAKE_WRONG) return brakeSet(groups, fresh, state);
    var candidates = groups.wrong.concat(groups.due);
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

  /** 記録の1件が「まちがえた答え」の形をしているか（日付・id・答えが文字列）。 */
  function isMistakeEntry(m) {
    return (
      isPlainObject(m) &&
      typeof m.date === "string" &&
      typeof m.id === "string" &&
      typeof m.given === "string"
    );
  }

  /**
   * まちがえた答えを state.mistakes に足す（14日より古い件・形の合わない件は捨てる）。
   * attempt はその回の中で何回目か（1＝初回）。出題・習得の判定には使わない。
   */
  function recordMistake(state, id, given, today, attempt) {
    var oldest = addDays(today, -(RECORD_DAYS - 1));
    var list = (Array.isArray(state.mistakes) ? state.mistakes : []).filter(function (m) {
      return isMistakeEntry(m) && m.date >= oldest;
    });
    list.push({ date: today, id: id, given: String(given), attempt: attempt });
    state.mistakes = list.slice(-MISTAKE_LOG_MAX);
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
    if (!correct) recordMistake(state, id, given, today, session.attempts[id]);
    var requeued = !correct && session.attempts[id] < MAX_TRIES;
    if (requeued) requeue(session, id);
    return { id: id, correct: correct, first: first, requeued: requeued };
  }

  // ---- バックアップ兼きろく ----

  /** 今日までの日別記録を新しい順に返す（バックアップ要約用）。 */
  function recentDays(state, today) {
    var oldest = addDays(today, -(RECORD_DAYS - 1));
    return Object.keys(state.days)
      .filter(function (d) {
        return d >= oldest && d <= today;
      })
      .sort()
      .reverse()
      .map(function (d) {
        var day = state.days[d];
        return {
          date: d,
          served: day.served.length,
          firstCorrect: day.firstCorrect.length,
          firstWrong: day.firstWrong.slice(),
        };
      });
  }

  /**
   * 直近の「まちがえた答え」を新しい順に返す（バックアップ要約・まちがいノート用）。
   * 今の問題データに無い id や形の合わない件は読み飛ばす。
   */
  function recentMistakes(state, problems, today) {
    if (!Array.isArray(state.mistakes)) return [];
    var byId = {};
    problems.forEach(function (p) {
      byId[p.id] = p;
    });
    var oldest = addDays(today, -(RECORD_DAYS - 1));
    return state.mistakes
      .map(function (m, i) {
        return { m: m, i: i };
      })
      .filter(function (x) {
        var m = x.m;
        return isMistakeEntry(m) && byId[m.id] && m.date >= oldest && m.date <= today;
      })
      .sort(function (a, b) {
        if (a.m.date !== b.m.date) return a.m.date < b.m.date ? 1 : -1;
        return b.i - a.i; // 同じ日は後に答えた方を先に
      })
      .map(function (x) {
        var p = byId[x.m.id];
        return {
          date: x.m.date,
          id: p.id,
          prompt: p.prompt,
          given: x.m.given,
          answer: p.answer,
          suffix: p.suffix || "",
          unit: p.unit,
          stage: p.stage,
          attempt: typeof x.m.attempt === "number" ? x.m.attempt : 1,
        };
      });
  }

  /** 段階別の「できる」数を集計する。 */
  function stageSummary(state, problems) {
    var stages = {};
    problems.forEach(function (p) {
      var s = stages[p.stage] || (stages[p.stage] = { stage: p.stage, total: 0, mastered: 0 });
      s.total += 1;
      var it = state.items[p.id];
      if (it && it.mastered === true) s.mastered += 1;
    });
    return Object.keys(stages)
      .map(function (k) {
        return stages[k];
      })
      .sort(function (a, b) {
        return a.stage - b.stage;
      });
  }

  /** 間違いの多い順に苦手問題を返す（間違い0で復習待ちでないものは除く）。 */
  function weakProblems(state, problems) {
    return problems
      .map(function (p) {
        var it = state.items[p.id];
        return it ? { p: p, it: it } : null;
      })
      .filter(function (x) {
        return x && (x.it.wrongCount > 0 || x.it.wrongPending);
      })
      .sort(function (a, b) {
        return b.it.wrongCount - a.it.wrongCount || (a.p.id < b.p.id ? -1 : 1);
      })
      .slice(0, WEAK_TOP_N)
      .map(function (x) {
        return {
          id: x.p.id,
          prompt: x.p.prompt,
          unit: x.p.unit,
          stage: x.p.stage,
          wrongCount: x.it.wrongCount,
          wrongPending: !!x.it.wrongPending,
          streak: x.it.streak,
          mastered: !!x.it.mastered,
        };
      });
  }

  /** 復元用の state と、読むための summary を1つにまとめる。 */
  function buildBackup(state, problems, today, appVersion) {
    var mastered = problems.filter(function (p) {
      var it = state.items[p.id];
      return it && it.mastered === true;
    }).length;
    return {
      app: BACKUP_APP_ID,
      format: BACKUP_FORMAT,
      exportedAt: today,
      appVersion: appVersion,
      summary: {
        masteredCount: mastered,
        totalCount: problems.length,
        stages: stageSummary(state, problems),
        weak: weakProblems(state, problems),
        recentDays: recentDays(state, today),
        mistakes: recentMistakes(state, problems, today),
      },
      state: state,
    };
  }

  /** items の各記録の形を確かめる（parseState は中身を見ない）。 */
  function itemsLookValid(items) {
    return Object.keys(items).every(function (id) {
      var it = items[id];
      return isPlainObject(it) && (it.due === null || typeof it.due === "string");
    });
  }

  /**
   * バックアップ文字列を検証して state を取り出す。
   * 戻り値: { ok: true, state } または { ok: false, reason }
   */
  function parseBackup(text, today) {
    var obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: "json" };
    }
    if (!isPlainObject(obj) || obj.app !== BACKUP_APP_ID) {
      return { ok: false, reason: "app" };
    }
    if (!isPlainObject(obj.state) || obj.state.version !== STATE_VERSION) {
      return { ok: false, reason: "version" };
    }
    var res = parseState(JSON.stringify(obj.state), today);
    if (res.notice || res.backup) return { ok: false, reason: "state" };
    if (!itemsLookValid(res.state.items)) return { ok: false, reason: "items" };
    return { ok: true, state: res.state };
  }

  /** バックアップのファイル名。 */
  function backupFileName(today) {
    return "tani_drill_backup_" + today + ".json";
  }

  /** storage に重ならない退避キー（_2, _3…）を返す。 */
  function uniqueArchiveKey(storage, base) {
    var key = base;
    var n = ARCHIVE_FIRST_SUFFIX;
    while (storage.getItem(key) !== null) {
      key = base + ARCHIVE_SUFFIX_SEP + n;
      n += 1;
    }
    return key;
  }

  /** 退避キーの並べ替え用に「日付」と「同日の連番」へ分ける。 */
  function archiveOrder(key) {
    var parts = key.slice(RESTORE_KEY_PREFIX.length).split(ARCHIVE_SUFFIX_SEP);
    return { date: parts[0], n: parts.length > 1 ? parseInt(parts[1], 10) || 0 : 1 };
  }

  /** 退避キーを新しい順に並べて返す。 */
  function listArchiveKeys(storage) {
    var keys = [];
    for (var i = 0; i < storage.length; i++) {
      var k = storage.key(i);
      if (k !== null && k.indexOf(RESTORE_KEY_PREFIX) === 0) keys.push(k);
    }
    return keys.sort(function (a, b) {
      var oa = archiveOrder(a);
      var ob = archiveOrder(b);
      if (oa.date !== ob.date) return oa.date < ob.date ? 1 : -1;
      return ob.n - oa.n;
    });
  }

  /** 古い退避キーを消し、新しい BACKUP_KEEP 本だけ残す（消せなくても復元は進める）。 */
  function pruneArchives(storage) {
    listArchiveKeys(storage)
      .slice(BACKUP_KEEP)
      .forEach(function (k) {
        try {
          storage.removeItem(k);
        } catch (e) {
          /* 古い控えを消せなくても復元は進める */
        }
      });
  }

  /**
   * 置換前に現記録（localStorage の生文字列）を別キーへ退避する。
   * - 現記録が無ければ退避しない（skipped）
   * - 書いたあと読み戻して一致を確かめる。例外・不一致は ok:false（呼び出し側は中止する）
   * 戻り値: { ok: true, skipped: true } / { ok: true, key } / { ok: false }
   */
  function archiveCurrentRecord(storage, today) {
    var key;
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return { ok: true, skipped: true };
      key = uniqueArchiveKey(storage, RESTORE_KEY_PREFIX + today);
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error("mismatch");
    } catch (e) {
      try {
        if (key) storage.removeItem(key);
      } catch (e2) {
        /* 後始末の失敗は無視（既存記録には触れていない） */
      }
      return { ok: false };
    }
    pruneArchives(storage);
    return { ok: true, key: key };
  }

  // ---- ドライブ自動保存（Apps Script 受け口）の純関数 ----

  var DRIVE_CONTENT_TYPE = "text/plain;charset=utf-8"; // application/json だとプリフライトで失敗するため使わない
  var DRIVE_KINDS = ["backup", "test"];
  var DRIVE_URL_HOST = "script.google.com"; // 受け口として認める https のホスト

  /**
   * 受け口へ送る fetch 用の引数を組み立てる。独自ヘッダーは付けない。
   * settings: {url, token} / backup: buildBackup の結果 / kind: "backup" | "test"
   */
  function buildDriveRequest(settings, backup, kind) {
    if (DRIVE_KINDS.indexOf(kind) < 0) throw new Error("kind が不正です");
    return {
      url: settings.url,
      options: {
        method: "POST",
        headers: { "Content-Type": DRIVE_CONTENT_TYPE },
        body: JSON.stringify({
          token: settings.token,
          app: backup.app,
          kind: kind,
          content: JSON.stringify(backup),
        }),
      },
    };
  }

  /** 受け口の応答本文を読む。{ok:true} のときだけ成功。壊れた JSON・ok:false・空は失敗。 */
  function parseDriveResponse(text) {
    try {
      var v = JSON.parse(text);
      return { ok: isPlainObject(v) && v.ok === true };
    } catch (e) {
      return { ok: false };
    }
  }

  /** localStorage の文字列から {url, token} を検証する。無効なら null。 */
  function parseDriveSettings(raw) {
    try {
      var v = JSON.parse(raw);
      if (!isPlainObject(v) || typeof v.url !== "string" || typeof v.token !== "string") return null;
      var url = v.url.trim();
      var token = v.token.trim();
      if (token === "") return null;
      var u = new URL(url);
      if (u.protocol !== "https:" || u.hostname !== DRIVE_URL_HOST) return null;
      return { url: url, token: token };
    } catch (e) {
      return null;
    }
  }

  // ---- 単位の見本カードの設定 ----

  var GUIDE_PX_DEFAULT = 52; // 画面上の実寸1cmの既定px
  var GUIDE_PX_MIN = 30;
  var GUIDE_PX_MAX = 90;
  var GUIDE_METER_MAX_LEN = 20; // 1m の見本の最大文字数

  /** 見本カードの設定（localStorage の文字列）を検証する。壊れていれば既定値。 */
  function parseGuideSettings(raw) {
    var result = { meterText: "", pxPerCm: GUIDE_PX_DEFAULT };
    try {
      var v = JSON.parse(raw);
      if (!isPlainObject(v)) return result;
      if (typeof v.meterText === "string") {
        result.meterText = v.meterText.trim().slice(0, GUIDE_METER_MAX_LEN);
      }
      if (typeof v.pxPerCm === "number" && isFinite(v.pxPerCm)) {
        result.pxPerCm = Math.min(GUIDE_PX_MAX, Math.max(GUIDE_PX_MIN, Math.round(v.pxPerCm)));
      }
      return result;
    } catch (e) {
      return result;
    }
  }

  var GUIDE_RESHOW_AWAY_MIN = 1; // 裏にいた時間(分)がこれ以上でホームに戻ったら見本カードを出し直す
  var MS_PER_MIN = 60000;

  /** 裏から戻った時に見本カードを出し直すか。ホームで、裏に GUIDE_RESHOW_AWAY_MIN 分以上いた時だけ真。 */
  function shouldReshowGuide(awayMs, screen) {
    if (typeof awayMs !== "number" || !isFinite(awayMs) || awayMs < 0) return false;
    return screen === "home" && awayMs >= GUIDE_RESHOW_AWAY_MIN * MS_PER_MIN;
  }

  var api = {
    shouldReshowGuide: shouldReshowGuide,
    GUIDE_RESHOW_AWAY_MIN: GUIDE_RESHOW_AWAY_MIN,
    parseGuideSettings: parseGuideSettings,
    GUIDE_PX_DEFAULT: GUIDE_PX_DEFAULT,
    GUIDE_PX_MIN: GUIDE_PX_MIN,
    GUIDE_PX_MAX: GUIDE_PX_MAX,
    GUIDE_METER_MAX_LEN: GUIDE_METER_MAX_LEN,
    buildDriveRequest: buildDriveRequest,
    parseDriveResponse: parseDriveResponse,
    parseDriveSettings: parseDriveSettings,
    STORAGE_KEY: STORAGE_KEY,
    BACKUP_KEY_PREFIX: BACKUP_KEY_PREFIX,
    RESTORE_KEY_PREFIX: RESTORE_KEY_PREFIX,
    buildBackup: buildBackup,
    parseBackup: parseBackup,
    backupFileName: backupFileName,
    archiveCurrentRecord: archiveCurrentRecord,
    listArchiveKeys: listArchiveKeys,
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
    recentMistakes: recentMistakes,
    RECORD_DAYS: RECORD_DAYS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TaniLogic = api;
  }
})(typeof window !== "undefined" ? window : this);
