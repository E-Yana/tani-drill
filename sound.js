/* 効果音（Web Audio で合成。音声ファイルは使わない）
 * window.DrillSound = { correct(), wrong(), soft(), isOn(), setOn(bool) }
 * - 既定はオン。オン/オフは localStorage の SOUND_KEY（バックアップ・復元の対象外）
 * - AudioContext は最初に鳴らす時に作り resume する（iPadの自動再生制限対策）
 * - 失敗しても例外は外へ出さない（音が鳴らないだけで学習は止めない）
 * - iPadのマナーモード/消音スイッチがオンだと Web Audio は鳴らない
 */
(function () {
  "use strict";

  // 保存キー（アプリごとに別。3アプリは別リポジトリのため同内容のファイルを置く）
  const SOUND_KEY = "taniDrill_sound";
  // 音量（控えめ）
  const MASTER_GAIN = 0.15;
  // 音の立ち上がり・減衰の長さ（秒）。プチ音を避ける
  const ATTACK_SEC = 0.01;
  const RELEASE_SEC = 0.04;
  // 正解「ピンポン」: 上がり2音（E6 -> C7）
  const CORRECT_NOTES = [
    { freq: 1318.5, start: 0, dur: 0.12 },
    { freq: 2093.0, start: 0.12, dur: 0.18 },
  ];
  // 不正解「ブー」: 低めの短い音
  const WRONG_NOTES = [{ freq: 200, start: 0, dur: 0.3 }];
  // 自己採点の×用「ポン」: 柔らかい下がり1音
  const SOFT_NOTES = [{ freq: 520, start: 0, dur: 0.22 }];

  let ctx = null;

  // オンかどうか（保存が無ければオン）
  function isOn() {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch (e) {
      return true;
    }
  }

  function setOn(on) {
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch (e) {
      /* 保存できなくても動作は続ける */
    }
  }

  // AudioContext を初回に作る。使えない環境では null
  function getCtx() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    return ctx;
  }

  // 1音を鳴らす
  function playNote(c, type, note) {
    const t0 = c.currentTime + note.start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(MASTER_GAIN, t0 + ATTACK_SEC);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + note.dur + RELEASE_SEC);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + note.dur + RELEASE_SEC + 0.01);
  }

  function play(type, notes) {
    try {
      if (!isOn()) return;
      const c = getCtx();
      if (!c) return;
      notes.forEach((n) => playNote(c, type, n));
    } catch (e) {
      /* 音が鳴らないだけ。例外は外へ出さない */
    }
  }

  window.DrillSound = {
    correct: () => play("sine", CORRECT_NOTES),
    wrong: () => play("triangle", WRONG_NOTES),
    soft: () => play("sine", SOFT_NOTES),
    isOn: isOn,
    setOn: setOn,
  };
})();
