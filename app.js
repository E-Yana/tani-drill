/**
 * たんいドリル 画面制御。出題・採点・保存形式は全部 TaniLogic に任せる。
 * APP_VERSION は sw.js の CACHE 番号と対で上げる。
 */
(function () {
  "use strict";

  const APP_VERSION = "7";
  const L = window.TaniLogic;
  const PROBLEMS = window.TANI_PROBLEMS;
  const STAGE_NAMES = {
    1: "3年のふくしゅう：長さ",
    2: "3年のふくしゅう：重さ・かさ・時間",
    3: "4年：小数と単位",
    4: "4年：面積（cm²・m²）",
    5: "4年：大きな面積（a・ha・km²）",
    6: "4年：単位えらび",
    7: "4年：まとめの文章題",
  };
  const DAILY_DONE_COUNT = 10; // 今日この数以上を出していたら「もう 10もん」
  const MAX_INPUT_LEN = 8; // 入力できる最大の文字数
  const BACKUP_REMIND_DAYS = 7; // 最終保存からこの日数たったら促す
  const MSG_ARCHIVE_FAILED = "いまの きろくを のこせなかったので、やめました。いまの きろくは そのままです";
  // 受け口が ok を返した日、または共有/ダウンロードを実行した日。Drive に入った保証は受け口 ok の時のみ
  const LAST_BACKUP_KEY = "taniDrill_lastBackup";
  const DRIVE_SYNC_KEY = "taniDrill_driveSync"; // ドライブ受け口の設定 {url, token}（記録 taniDrill_v1 とは別キー）
  const DRIVE_TIMEOUT_MS = 15000; // 受け口への送信の時間切れ
  const MSG_DRIVE_OK = "ドライブに ほぞんしました";
  const MSG_DRIVE_FAILED = "ドライブに ほぞんできませんでした。もう一度 おすと ファイルで ほぞん";
  const BY_ID = {};
  PROBLEMS.forEach((p) => {
    BY_ID[p.id] = p;
  });

  let state = null;
  let session = null;
  let notice = null;
  let today = L.localDateString();
  let sessionTotal = 0;
  let firstWrongIds = []; // この回の1回目で間違えた id
  let firstCorrectCount = 0;
  let inputText = "";
  let currentProblem = null;
  let answered = false;
  let sessionOrder = {}; // id -> この回で最初に出た番号
  let fileFallbackPending = false; // ドライブ送信に失敗済み＝次のタップで共有/ダウンロードを開く
  let driveBusy = false; // ドライブ送信中の二重タップ防止

  const $ = (id) => document.getElementById(id);

  // ---- 保存（localStorage はすべて try/catch） ----

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* 保存できなくても画面は動かす */
    }
  }

  /** 既にある key と重ならない退避 key を返す（_2, _3…）。 */
  function uniqueBackupKey(base) {
    let key = base;
    let n = 2;
    while (safeGet(key) !== null) {
      key = base + "_" + n;
      n += 1;
    }
    return key;
  }

  function saveState() {
    safeSet(L.STORAGE_KEY, L.serializeState(state));
  }

  function loadState() {
    today = L.localDateString();
    const res = L.parseState(safeGet(L.STORAGE_KEY), today);
    state = res.state;
    notice = res.notice || null;
    if (res.backup) safeSet(uniqueBackupKey(res.backup.key), res.backup.value);
  }

  // ---- 画面切り替え ----

  function showScreen(name) {
    ["home", "quiz", "result"].forEach((n) => {
      $("screen-" + n).classList.toggle("hidden", n !== name);
    });
    window.scrollTo(0, 0);
  }

  // ---- ホーム ----

  function isMastered(id) {
    const it = state.items[id];
    return !!it && it.mastered === true;
  }

  function stageCounts() {
    const stats = {};
    PROBLEMS.forEach((p) => {
      const s = stats[p.stage] || (stats[p.stage] = { total: 0, done: 0 });
      s.total += 1;
      if (isMastered(p.id)) s.done += 1;
    });
    return stats;
  }

  function renderStages() {
    const stats = stageCounts();
    const box = $("home-stages");
    box.innerHTML = "";
    Object.keys(stats).forEach((stage) => {
      const s = stats[stage];
      const row = document.createElement("div");
      row.className = "stage-row";
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      row.innerHTML =
        '<span class="stage-name"></span><span class="stage-bar"><span class="stage-bar-fill"></span></span><span class="stage-count"></span>';
      row.querySelector(".stage-name").textContent = STAGE_NAMES[stage] || "だんかい " + stage;
      row.querySelector(".stage-bar-fill").style.width = pct + "%";
      row.querySelector(".stage-count").textContent = s.done + "/" + s.total;
      box.appendChild(row);
    });
  }

  function renderHome() {
    today = L.localDateString();
    const done = PROBLEMS.filter((p) => isMastered(p.id)).length;
    $("home-progress").textContent = "できる " + done + "問 / " + PROBLEMS.length + "問";
    $("home-notice").classList.toggle("hidden", notice !== "corrupt");
    const day = state.days[today];
    const finishedToday = !!day && day.served.length >= DAILY_DONE_COUNT;
    $("btn-start").textContent = finishedToday ? "もう 10もん やる" : "きょうの 10もん";
    $("home-today").textContent = finishedToday
      ? "きょうは " + day.served.length + "もん やったよ。えらい！"
      : "";
    $("app-version").textContent = "v" + APP_VERSION;
    renderBackupRemind();
    renderStages();
    showScreen("home");
  }

  // ---- バックアップ兼きろく ----

  function hasAnyRecord() {
    return Object.keys(state.days).length > 0;
  }

  function renderBackupRemind() {
    const last = safeGet(LAST_BACKUP_KEY);
    const due = !last || L.addDays(last, BACKUP_REMIND_DAYS) <= today;
    $("backup-remind").classList.toggle("hidden", !(hasAnyRecord() && due));
  }

  function setStatus(id, text) {
    const el = $(id);
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function markBackedUp() {
    safeSet(LAST_BACKUP_KEY, L.localDateString());
    renderBackupRemind();
  }

  /** 受け口へ送って ok:true を読めた時だけ true を返す（時間切れ・オフライン・非200・壊れた応答は false）。 */
  async function sendToDrive(settings, backup, kind) {
    const req = L.buildDriveRequest(settings, backup, kind);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DRIVE_TIMEOUT_MS);
    try {
      const res = await fetch(req.url, Object.assign({ signal: ctrl.signal }, req.options));
      if (!res.ok) return false;
      return L.parseDriveResponse(await res.text()).ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 従来の経路（共有シート、だめならダウンロード）。挙動は変えない。 */
  async function saveBackupAsFile(file) {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        setStatus("backup-status", "ほぞんの がめんを ひらきました。「ファイルに ほぞん」→「ドライブ」");
      } else {
        downloadFile(file);
        setStatus("backup-status", "ファイルを ダウンロードしました");
      }
      markBackedUp();
    } catch (e) {
      if (e && e.name === "AbortError") return; // とちゅうで やめた
      try {
        downloadFile(file);
        setStatus("backup-status", "ファイルを ダウンロードしました");
        markBackedUp();
      } catch (e2) {
        setStatus("backup-status", "ほぞんできませんでした");
      }
    }
  }

  /** ドライブ設定済みなら送信。失敗時は markBackedUp も共有も呼ばず、次のタップで従来経路へ。 */
  async function saveBackupToDrive(settings, backup) {
    driveBusy = true;
    setStatus("backup-status", "ドライブに ほぞんしています…");
    try {
      if (await sendToDrive(settings, backup, "backup")) {
        fileFallbackPending = false;
        markBackedUp();
        setStatus("backup-status", MSG_DRIVE_OK);
      } else {
        fileFallbackPending = true;
        setStatus("backup-status", MSG_DRIVE_FAILED);
      }
    } finally {
      driveBusy = false;
    }
  }

  async function saveBackup() {
    if (driveBusy) return;
    const now = L.localDateString();
    const backup = L.buildBackup(state, PROBLEMS, now, APP_VERSION);
    const file = new File([JSON.stringify(backup, null, 2)], L.backupFileName(now), {
      type: "application/json",
    });
    const settings = L.parseDriveSettings(safeGet(DRIVE_SYNC_KEY));
    if (!settings || fileFallbackPending) {
      // 未設定、または直前のドライブ送信が失敗＝今のタップで従来経路を開く
      fileFallbackPending = false;
      await saveBackupAsFile(file);
      return;
    }
    await saveBackupToDrive(settings, backup);
  }

  // ---- ドライブの設定欄 ----

  function loadDriveForm() {
    const s = L.parseDriveSettings(safeGet(DRIVE_SYNC_KEY));
    $("drive-url").value = s ? s.url : "";
    $("drive-token").value = s ? s.token : "";
  }

  function readDriveForm() {
    return L.parseDriveSettings(JSON.stringify({ url: $("drive-url").value, token: $("drive-token").value }));
  }

  function saveDriveSettings() {
    const s = readDriveForm();
    if (!s) {
      setStatus("drive-status", "URLか あいことばが ただしくありません。ほぞんしませんでした");
      return;
    }
    safeSet(DRIVE_SYNC_KEY, JSON.stringify(s));
    fileFallbackPending = false;
    setStatus("drive-status", "せっていを ほぞんしました");
  }

  async function testDrive() {
    if (driveBusy) return;
    const s = readDriveForm();
    if (!s) {
      setStatus("drive-status", "URLか あいことばが ただしくありません");
      return;
    }
    driveBusy = true;
    setStatus("drive-status", "ためしています…");
    try {
      const backup = L.buildBackup(state, PROBLEMS, L.localDateString(), APP_VERSION);
      const ok = await sendToDrive(s, backup, "test");
      setStatus("drive-status", ok ? "ためしに ほぞんできました" : "ためしに ほぞんできませんでした");
    } finally {
      driveBusy = false;
    }
  }

  function restoreBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = L.parseBackup(String(reader.result), L.localDateString());
      if (!res.ok) {
        setStatus("restore-status", "このファイルは つかえません。いまの きろくは そのままです");
        return;
      }
      if (!confirm("いまの きろくを ファイルの きろくに おきかえます。いいですか？")) return;
      // 現記録があるのに退避できなかった時だけ中止する（記録が空の端末では退避を飛ばして復元できる）
      const arch = L.archiveCurrentRecord(localStorage, L.localDateString());
      if (!arch.ok) {
        setStatus("restore-status", MSG_ARCHIVE_FAILED);
        return;
      }
      state = res.state;
      saveState();
      markBackedUp();
      setStatus("restore-status", "もとに もどしました");
      renderHome();
    };
    reader.onerror = () => setStatus("restore-status", "ファイルを よめませんでした");
    reader.readAsText(file);
  }

  // ---- 出題 ----

  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startToday() {
    loadState();
    const ids = L.buildDailySet(PROBLEMS, state, today);
    session = L.startSession(ids);
    sessionTotal = ids.length;
    firstWrongIds = [];
    firstCorrectCount = 0;
    sessionOrder = {};
    nextQuestion();
  }

  function renderNumberDisplay() {
    $("number-display").textContent = inputText;
    $("btn-submit").disabled = inputText === "" || inputText === ".";
  }

  function renderChoices(p) {
    const box = $("quiz-choices");
    box.innerHTML = "";
    shuffled(p.choices).forEach((c) => {
      const b = document.createElement("button");
      b.className = "big-btn";
      b.textContent = c;
      b.addEventListener("click", () => onAnswer(c, b));
      box.appendChild(b);
    });
  }

  function nextQuestion() {
    if (L.isFinished(session)) {
      showResult();
      return;
    }
    const id = L.currentId(session);
    currentProblem = BY_ID[id];
    answered = false;
    const p = currentProblem;
    if (!sessionOrder[id]) sessionOrder[id] = Object.keys(sessionOrder).length + 1;
    const retry = (session.attempts[id] || 0) >= 1;
    $("quiz-progress").textContent = sessionOrder[id] + " / " + sessionTotal;
    $("quiz-retry").classList.toggle("hidden", !retry);
    $("quiz-stage").textContent = STAGE_NAMES[p.stage] || "";
    $("quiz-prompt").textContent = p.prompt;
    $("quiz-feedback").classList.add("hidden");
    const isChoice = p.type === "choice";
    $("quiz-choices").classList.toggle("hidden", !isChoice);
    $("quiz-number").classList.toggle("hidden", isChoice);
    if (isChoice) {
      renderChoices(p);
    } else {
      inputText = "";
      $("number-suffix").textContent = p.suffix || "";
      renderNumberDisplay();
    }
    showScreen("quiz");
  }

  function onKey(key) {
    if (answered) return;
    if (key === "del") {
      inputText = inputText.slice(0, -1);
    } else if (inputText.length < MAX_INPUT_LEN) {
      if (key === "." && inputText.indexOf(".") >= 0) return; // 小数点は1つまで
      inputText += key;
    }
    renderNumberDisplay();
  }

  function markChoices(given) {
    Array.prototype.forEach.call($("quiz-choices").children, (b) => {
      b.disabled = true;
      if (b.textContent === currentProblem.answer) b.classList.add("correct");
      else if (b.textContent === given) b.classList.add("wrong");
    });
  }

  function showFeedback(result) {
    const p = currentProblem;
    const msg = $("feedback-msg");
    msg.textContent = result.correct ? "せいかい！" : "ざんねん";
    msg.className = "feedback-msg " + (result.correct ? "ok" : "ng");
    $("feedback-answer").textContent = result.correct
      ? ""
      : "こたえ： " + p.answer + (p.suffix || "");
    $("feedback-explain").textContent = p.explain || "";
    $("btn-submit").disabled = true;
    $("quiz-feedback").classList.remove("hidden");
  }

  /** この回で初めて答えた問題の結果を集計する。 */
  function tallyFirstAttempt(result) {
    if (session.attempts[result.id] !== 1) return;
    if (result.correct) firstCorrectCount += 1;
    else firstWrongIds.push(result.id);
  }

  function onAnswer(given, choiceButton) {
    if (answered) return;
    answered = true;
    const result = L.submitAnswer(session, currentProblem, given, state, today);
    saveState(); // 1問ごとに保存
    tallyFirstAttempt(result);
    if (choiceButton) markChoices(given);
    showFeedback(result);
  }

  // ---- 結果 ----

  function showResult() {
    $("result-score").textContent = firstCorrectCount + " / " + sessionTotal;
    const box = $("result-wrongs");
    box.innerHTML = "";
    $("result-wrongs-panel").classList.toggle("hidden", firstWrongIds.length === 0);
    firstWrongIds.forEach((id) => {
      const p = BY_ID[id];
      const item = document.createElement("div");
      item.className = "wrong-item";
      item.innerHTML = '<div class="wrong-prompt"></div><div class="wrong-answer"></div>';
      item.querySelector(".wrong-prompt").textContent = p.prompt;
      item.querySelector(".wrong-answer").textContent = "こたえ： " + p.answer + (p.suffix || "");
      box.appendChild(item);
    });
    showScreen("result");
  }

  // ---- 起動 ----

  function bindEvents() {
    $("btn-start").addEventListener("click", startToday);
    $("btn-backup").addEventListener("click", saveBackup);
    $("drive-save").addEventListener("click", saveDriveSettings);
    $("drive-test").addEventListener("click", testDrive);
    $("restore-file").addEventListener("change", (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) restoreBackup(f);
      ev.target.value = "";
    });
    $("btn-next").addEventListener("click", nextQuestion);
    $("btn-quit").addEventListener("click", renderHome);
    $("btn-result-home").addEventListener("click", () => {
      notice = null;
      renderHome();
    });
    $("btn-submit").addEventListener("click", () => {
      if (inputText !== "" && inputText !== ".") onAnswer(inputText, null);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".key"), (k) => {
      k.addEventListener("click", () => onKey(k.dataset.key));
    });
  }

  /** Service Worker を登録し、更新が入ったらホームにバナーを出す。 */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
    // 起動時に SW が制御中だった場合の controllerchange だけを「更新」とみなす（初回インストールは除く）
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadControllerAtLoad) return;
      const btn = $("home-update-banner");
      btn.classList.remove("hidden");
      btn.onclick = () => location.reload();
    });
    navigator.serviceWorker
      .register("sw.js")
      // 自動チェックは最大24時間に1回のため、起動のたび明示的に確認する
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  }

  function init() {
    loadState();
    bindEvents();
    loadDriveForm();
    renderHome();
    registerServiceWorker();
  }

  init();
})();
