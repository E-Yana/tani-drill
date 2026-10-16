// logic.js のテスト（fixture のみ使用・data.js は読まない）。実行: node gen/test_logic.js
"use strict";
const assert = require("assert");
const L = require("../logic.js");

/** fixture 問題を作る（stage 指定・number 型）。 */
function prob(id, stage, answer) {
  return { id, stage, unit: "長さ", type: "number", prompt: "問題" + id, answer: answer || "1", explain: "" };
}

/** n 問の fixture（stage は 1,1,2,2,... と上がる）。 */
function makeProblems(n) {
  return Array.from({ length: n }, (_, i) => prob("t-" + String(i + 1).padStart(4, "0"), Math.floor(i / 2) + 1));
}

/** 1問に1回回答する（セッション1問だけ）。 */
function answerOnce(state, p, given, today) {
  const s = L.startSession([p.id]);
  return L.submitAnswer(s, p, given, state, today);
}

const D1 = "2026-10-16";
const D2 = "2026-10-17";
const D3 = "2026-10-18";
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("serves_ten_new_per_day_in_stage_order", () => {
  const ps = makeProblems(20).reverse(); // 配列は逆順、stage は昇順を保つ
  const ids = L.buildDailySet(ps, L.emptyState(), D1);
  assert.strictEqual(ids.length, 10);
  const stages = ids.map((id) => ps.find((p) => p.id === id).stage);
  assert.deepStrictEqual(stages, stages.slice().sort((a, b) => a - b));
  assert.strictEqual(Math.max(...stages), 5);
  // 同じ stage は配列の順
  assert.deepStrictEqual(ids.slice(0, 2), ["t-0002", "t-0001"]);
});

test("wrong_answer_returns_after_two_max_three_times", () => {
  const ps = makeProblems(5);
  const st = L.emptyState();
  const s = L.startSession(ps.map((p) => p.id));
  L.submitAnswer(s, ps[0], "x", st, D1);
  assert.deepStrictEqual(s.queue, ["t-0002", "t-0003", "t-0001", "t-0004", "t-0005"]);
  // 残りが2問未満なら末尾
  const s2 = L.startSession(["t-0001", "t-0002"]);
  L.submitAnswer(s2, ps[0], "x", L.emptyState(), D1);
  assert.deepStrictEqual(s2.queue, ["t-0002", "t-0001"]);
  // 最大3回
  const s3 = L.startSession(["t-0001"]);
  const st3 = L.emptyState();
  let count = 0;
  while (!L.isFinished(s3)) {
    L.submitAnswer(s3, ps[0], "x", st3, D1);
    count++;
  }
  assert.strictEqual(count, 3);
});

test("requeues_do_not_count_toward_ten", () => {
  const ps = makeProblems(20);
  const st = L.emptyState();
  const ids = L.buildDailySet(ps, st, D1);
  const s = L.startSession(ids);
  L.submitAnswer(s, ps[0], "x", st, D1);
  assert.strictEqual(new Set(ids).size, 10);
  assert.strictEqual(s.queue.length, 10); // 9問残り＋入れ直し1
  assert.strictEqual(st.days[D1].served.length, 1);
  assert.strictEqual(new Set(s.queue).size, 10); // 10個の別々の問題が残っている
});

test("first_miss_does_not_count_as_streak", () => {
  const ps = makeProblems(3);
  const st = L.emptyState();
  const s = L.startSession(["t-0001", "t-0002", "t-0003"]);
  L.submitAnswer(s, ps[0], "x", st, D1);
  const it = st.items["t-0001"];
  assert.deepStrictEqual(
    [it.streak, it.mastered, it.level, it.wrongPending, it.due, it.wrongCount],
    [0, false, 0, true, D2, 1]
  );
  // 入れ直しで正解しても streak は 0 のまま
  while (!L.isFinished(s)) {
    const id = L.currentId(s);
    L.submitAnswer(s, ps.find((p) => p.id === id), "1", st, D1);
  }
  assert.strictEqual(st.items["t-0001"].streak, 0);
  assert.strictEqual(st.items["t-0001"].wrongCount, 1);
});

test("mastered_needs_correct_on_two_separate_days", () => {
  const p = prob("t-0001", 1);
  const st = L.emptyState();
  answerOnce(st, p, "1", D1);
  let it = st.items[p.id];
  assert.deepStrictEqual(
    [it.streak, it.due, it.lastCorrectDate, it.wrongPending, it.mastered],
    [1, D2, D1, false, false]
  );
  // 同じ日の2回目のセッションでは増えない
  answerOnce(st, p, "1", D1);
  assert.strictEqual(st.items[p.id].streak, 1);
  // 別の日で習得
  answerOnce(st, p, "1", D2);
  it = st.items[p.id];
  assert.deepStrictEqual([it.streak, it.mastered, it.level, it.due], [2, true, 0, L.addDays(D2, 2)]);
});

test("mastered_intervals_2_4_8_16_capped", () => {
  const p = prob("t-0001", 1);
  const st = L.emptyState();
  let day = D1;
  answerOnce(st, p, "1", day);
  const dues = [];
  const levels = [];
  for (let i = 0; i < 6; i++) {
    day = L.addDays(day, 1);
    answerOnce(st, p, "1", day);
    dues.push((Date.parse(st.items[p.id].due) - Date.parse(day)) / 86400000);
    levels.push(st.items[p.id].level);
    day = st.items[p.id].due; // 期限日に解く
  }
  assert.deepStrictEqual(dues, [2, 4, 8, 16, 16, 16]);
  assert.deepStrictEqual(levels, [0, 1, 2, 3, 3, 3]);
});

test("miss_after_mastered_resets_streak", () => {
  const p = prob("t-0001", 1);
  const st = L.emptyState();
  answerOnce(st, p, "1", D1);
  answerOnce(st, p, "1", D2);
  assert.strictEqual(st.items[p.id].mastered, true);
  answerOnce(st, p, "x", D3);
  const it = st.items[p.id];
  assert.deepStrictEqual(
    [it.streak, it.mastered, it.level, it.wrongPending, it.due, it.wrongCount],
    [0, false, 0, true, L.addDays(D3, 1), 1]
  );
});

test("next_day_review_wrong_first_max_five_then_due_then_new", () => {
  const ps = makeProblems(40);
  const st = L.emptyState();
  const base = { streak: 1, mastered: false, level: 0, wrongPending: false, lastCorrectDate: "2026-10-15", wrongCount: 0 };
  // 出題済み: 1〜8。うち 7,8 は wrongPending、1〜6 は期限到来（古さ違い）
  for (let i = 1; i <= 8; i++) {
    const id = "t-000" + i;
    st.items[id] = Object.assign({}, base, { due: "2026-10-1" + (i % 3), wrongPending: i >= 7 });
  }
  const ids = L.buildDailySet(ps, st, D2);
  assert.strictEqual(ids.length, 10);
  // 復習は wrongPending 2問が先頭（due・id順）、その後 due の古い順に3問
  assert.deepStrictEqual(ids.slice(0, 2), ["t-0008", "t-0007"].sort((a, b) => (st.items[a].due < st.items[b].due ? -1 : st.items[a].due > st.items[b].due ? 1 : a < b ? -1 : 1)));
  const review = ids.filter((id) => st.items[id]);
  assert.strictEqual(review.length, 5);
  const fresh = ids.filter((id) => !st.items[id]);
  assert.deepStrictEqual(fresh, ["t-0009", "t-0010", "t-0011", "t-0012", "t-0013"]);
  // 未出題が足りないときは溢れた復習で埋める
  const few = makeProblems(9);
  const st2 = L.emptyState();
  for (let i = 1; i <= 8; i++) st2.items["t-000" + i] = Object.assign({}, base, { due: "2026-10-16" });
  const ids2 = L.buildDailySet(few, st2, D2);
  assert.strictEqual(ids2.length, 9);
  assert.strictEqual(new Set(ids2).size, 9);
});

test("after_all_served_due_soonest_first", () => {
  const ps = makeProblems(12);
  const st = L.emptyState();
  ps.forEach((p, i) => {
    // 期限前（未来）のものも含め、i が小さいほど遅い期限
    st.items[p.id] = { streak: 2, mastered: true, level: 0, due: L.addDays("2026-11-01", 12 - i), wrongPending: false, lastCorrectDate: D1, wrongCount: 0 };
  });
  const ids = L.buildDailySet(ps, st, D2);
  assert.strictEqual(ids.length, 10);
  assert.deepStrictEqual(ids[0], "t-0012");
  assert.deepStrictEqual(ids[9], "t-0003");
});

test("decimal_answer_compared_numerically", () => {
  const num = (a) => ({ type: "number", answer: a });
  assert.ok(L.isCorrect(num("1.5"), "1.50"));
  assert.ok(L.isCorrect(num("34"), "034"));
  assert.ok(L.isCorrect(num("0.35"), "0.350"));
  assert.ok(L.isCorrect(num("12"), " 12. "));
  assert.ok(!L.isCorrect(num("1"), "."));
  assert.ok(!L.isCorrect(num("1"), ""));
  assert.ok(!L.isCorrect(num("1.2"), "1.2.3"));
  const ch = { type: "choice", answer: "cm", choices: ["cm", "m", "mm"] };
  assert.ok(L.isCorrect(ch, "cm"));
  assert.ok(!L.isCorrect(ch, "m"));
});

test("corrupt_storage_backed_up_and_notified", () => {
  for (const raw of ["{broken", JSON.stringify({ version: 99, items: {}, days: {} })]) {
    const r = L.parseState(raw, D1);
    assert.strictEqual(r.notice, "corrupt");
    assert.deepStrictEqual(r.backup, { key: "taniDrill_v1_backup_" + D1, value: raw });
    assert.deepStrictEqual(r.state, L.emptyState());
  }
  const none = L.parseState(null, D1);
  assert.strictEqual(none.notice, undefined);
  assert.strictEqual(none.backup, undefined);
  assert.deepStrictEqual(none.state, L.emptyState());
});

test("known_old_version_migrated", () => {
  const items = { "t-0001": { streak: 1, mastered: false, level: 0, due: D2, wrongPending: false, lastCorrectDate: D1, wrongCount: 0 } };
  const r = L.parseState(JSON.stringify({ items }), D1);
  assert.strictEqual(r.notice, undefined);
  assert.strictEqual(r.backup, undefined);
  assert.strictEqual(r.state.version, 1);
  assert.deepStrictEqual(r.state.days, {});
  assert.deepStrictEqual(r.state.items, items);
});

test("reordering_stages_keeps_ids_stable", () => {
  const ps = makeProblems(20);
  const st = L.emptyState();
  answerOnce(st, ps[3], "x", D1); // t-0004 を間違える
  // 配列を逆順にして stage も入れ替える
  const reordered = ps.slice().reverse().map((p, i) => Object.assign({}, p, { stage: Math.floor(i / 2) + 1 }));
  const ids = L.buildDailySet(reordered, st, D2);
  assert.strictEqual(ids[0], "t-0004");
  assert.strictEqual(st.items["t-0004"].wrongPending, true);
});

test("backup_roundtrip_restores_state", () => {
  const ps = makeProblems(6);
  const st = L.emptyState();
  answerOnce(st, ps[0], "x", D1); // 間違い
  answerOnce(st, ps[1], "1", D1); // 正解
  const text = JSON.stringify(L.buildBackup(st, ps, D1, "3"));
  const res = L.parseBackup(text, D1);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.state, st);
});

test("backup_summary_lists_weak_by_wrong_count", () => {
  const ps = makeProblems(6);
  const st = L.emptyState();
  answerOnce(st, ps[0], "x", D1);
  answerOnce(st, ps[2], "x", D1);
  answerOnce(st, ps[2], "x", D2);
  const b = L.buildBackup(st, ps, D2, "3");
  assert.strictEqual(b.summary.weak[0].id, ps[2].id);
  assert.strictEqual(b.summary.weak[0].wrongCount, 2);
  assert.strictEqual(b.summary.weak.length, 2);
  assert.strictEqual(b.summary.totalCount, 6);
  assert.strictEqual(b.summary.recentDays[0].date, D2);
});

test("parse_backup_rejects_bad_input_without_throwing", () => {
  const ps = makeProblems(2);
  const good = L.buildBackup(L.emptyState(), ps, D1, "3");
  const withState = (patch) => JSON.stringify(Object.assign({}, good, { state: Object.assign({}, good.state, patch) }));
  assert.strictEqual(L.parseBackup("{broken", D1).ok, false);
  assert.strictEqual(L.parseBackup(JSON.stringify({ app: "other", state: good.state }), D1).ok, false);
  assert.strictEqual(L.parseBackup(withState({ version: 99 }), D1).ok, false);
  assert.strictEqual(L.parseBackup(withState({ version: undefined }), D1).ok, false);
  assert.strictEqual(L.parseBackup(withState({ items: { x: "a" } }), D1).ok, false);
  assert.strictEqual(L.parseBackup(withState({ items: { x: { due: 5 } } }), D1).ok, false);
});

test("backup_file_name_has_date", () => {
  assert.strictEqual(L.backupFileName(D1), "tani_drill_backup_2026-10-16.json");
});

/** localStorage の代わりになる簡易ストレージ。 */
function fakeStorage(init, opts) {
  const m = new Map(Object.entries(init || {}));
  const o = opts || {};
  return {
    get length() {
      return m.size;
    },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (o.failSet) throw new Error("quota");
      m.set(k, o.corruptOnSet ? v + "x" : v);
    },
    removeItem: (k) => m.delete(k),
    keys: () => Array.from(m.keys()),
  };
}

test("archive_skips_when_no_current_record", () => {
  const s = fakeStorage();
  assert.deepStrictEqual(L.archiveCurrentRecord(s, D1), { ok: true, skipped: true });
  assert.deepStrictEqual(s.keys(), []);
});

test("archive_copies_raw_and_aborts_on_failure", () => {
  const raw = '{"version":1}';
  const s = fakeStorage({ [L.STORAGE_KEY]: raw });
  const r1 = L.archiveCurrentRecord(s, D1);
  const r2 = L.archiveCurrentRecord(s, D1);
  assert.strictEqual(r1.key, L.RESTORE_KEY_PREFIX + D1);
  assert.strictEqual(r2.key, L.RESTORE_KEY_PREFIX + D1 + "_2");
  assert.strictEqual(s.getItem(r1.key), raw);
  const bad = fakeStorage({ [L.STORAGE_KEY]: raw }, { corruptOnSet: true });
  assert.strictEqual(L.archiveCurrentRecord(bad, D1).ok, false);
  assert.deepStrictEqual(bad.keys(), [L.STORAGE_KEY]);
  const full = fakeStorage({ [L.STORAGE_KEY]: raw }, { failSet: true });
  assert.strictEqual(L.archiveCurrentRecord(full, D1).ok, false);
  assert.strictEqual(full.getItem(L.STORAGE_KEY), raw);
});

test("archive_keeps_only_newest_two", () => {
  const s = fakeStorage({ [L.STORAGE_KEY]: '{"version":1}' });
  ["2026-10-14", "2026-10-15", D1, D1].forEach((d) => L.archiveCurrentRecord(s, d));
  assert.deepStrictEqual(L.listArchiveKeys(s), [L.RESTORE_KEY_PREFIX + D1 + "_2", L.RESTORE_KEY_PREFIX + D1]);
});

test("archive_does_not_prune_corrupt_data_backups", () => {
  const corruptKeys = ["2026-10-01", "2026-10-02", "2026-10-03"].map((d) => L.BACKUP_KEY_PREFIX + d);
  const init = { [L.STORAGE_KEY]: '{"version":1}' };
  corruptKeys.forEach((k) => (init[k] = "broken"));
  const s = fakeStorage(init);
  [D1, D1, D1].forEach((d) => L.archiveCurrentRecord(s, d));
  corruptKeys.forEach((k) => assert.strictEqual(s.getItem(k), "broken"));
  assert.strictEqual(L.listArchiveKeys(s).length, 2);
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log("PASS " + t.name);
  } catch (e) {
    failed++;
    console.log("FAIL " + t.name + "\n  " + e.message);
  }
}
console.log(tests.length + "件中 " + (tests.length - failed) + "件 PASS");
process.exit(failed ? 1 : 0);
