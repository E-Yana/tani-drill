# たんいドリル（小4）— このアプリの説明（Claude向け）

小学4年生の「単位」練習アプリ（長さ・重さ・かさ・時間・面積）。iPadで使う。公開サイト: https://e-yana.github.io/tani-drill/
子どもの学習記録はiPadの中（localStorage `taniDrill_v1`）にしか無く、外から書き込めない。
代わりに、ホームの「きろくを ほぞん」で `tani_drill_backup_YYYY-MM-DD.json` を作る（バックアップ兼きろく）。ドライブの設定（`taniDrill_driveSync`＝URL・合言葉）が済んでいれば Apps Script の受け口（`drive_sync.gs`）へ送り、専用フォルダに入る。未設定、または送信に失敗した次のタップでは、共有シート/ダウンロードでファイルに保存する。
全100問・7段階。出題・採点・保存形式は `logic.js`（`window.TaniLogic`）、問題は `data.js`、画面は `app.js`。

## 問題を足す・直す手順
1. `gen/make_data.py` の問題定義を直す。**id は各問題にソースで固定**。一度使った id は変えない・使い回さない（直したいときも同じ id のまま中身を直す。足すときは次の番号）
2. number の問題は検算（`Decimal`）が必須。choice は3択・重複なし・answer を含む
3. `python3 gen/make_data.py data.js` で生成する（既存の id が消えると失敗終了する）
4. `node gen/test_logic.js` でテストを通す
5. `app.js` の `APP_VERSION` と `sw.js` の `CACHE` を対で上げる
6. コミットして公開する

## 守ること
- `app.js` の `APP_VERSION` と `sw.js` の `CACHE`（`tani-drill-vN`）は対で上げる。**CACHE を上げないと iPad のホームに出る「新しいバージョンがあります」バナーも出ない**（v4 以降の端末のみ）
- `data.js` を手で直さない（必ず `gen/make_data.py` から生成）
- 問題の id を変えない・再利用しない
- 公開リポジトリなので、子どもの名前・学校名・住所などは書かない
- 5年の先取り（体積・L と cm³・速さ・小数×小数・小数÷小数）を入れない

## バックアップJSONの読み方
- `summary`＝読む用：`masteredCount`/`totalCount`、`stages`（段階別の total・mastered）、`weak`（間違い回数の多い順に最大10件）、`recentDays`（直近14日の出した数・1回目正解数・まちがい id）、`mistakes`（v8〜。直近14日のまちがえた答え・新しい順。`prompt`・`given`＝子どもの答え・`answer`・`suffix`・`attempt`＝その回の中で何回目か）。`state`＝復元用（`ふくげん`で読み戻す）
- `state.mistakes`（v8〜・任意項目）＝`{date, id, given, attempt}` の追記のみ。14日より古い件は記録時に捨てる。読むときに形を検査して不正な件は読み飛ばす。出題・習得の判定には使わない。v7以前の記録には無い（`STATE_VERSION`・`format` は据え置き）
- `taniDrill_lastBackup`（ホームの「ほぞんしよう」促し7日）＝受け口が ok を返した日、または共有/ダウンロードを**実行した日**。Driveに入った保証は受け口 ok の時のみ
- `taniDrill_driveSync`＝`{url, token}` のJSON。`taniDrill_v1`・`STATE_VERSION` とは別キー。値をコード・ログ・コミットに書かない
- 受け口の実体は Apps Script「学習アプリ受け口」（3アプリ共用）。Mac の `~/gas/learning-apps-receiver/` から clasp（`npx @google/clasp@3.4.1`）で `push` → `create-deployment -i <既存ID>` で同じURLのまま更新する。秘密（`config.gs`・`.token`・`.url`）はそのフォルダだけに置く
- 受け口の kind（2026-10-25〜）：`backup`・`test`（書き込み）に加え、`import_list`（`<元>_import_*.json` を古い順に最大10件・中身つきで返す。Googleドキュメントに変換されたものは `skipped` に名前だけ）・`import_done`（content＝id配列のJSON。同じフォルダ・同じ接頭辞のファイルだけゴミ箱へ）。読み出しを使うのは今は漢字だけ（写真からの取り込み）
- 形式を変える時は `format` を上げ、`parseBackup` を直す（`BACKUP_APP_ID`・`STATE_VERSION` の確認あり）
- 復元前の退避は `taniDrill_v1_restore_<日付>[_n]`（新しい2本だけ残る）。`taniDrill_v1_backup_` は壊れたデータの控えで、刈り込みの対象外
- 出題のブレーキ（v10〜・`logic.js` の `buildDailySet`）：間違えたまま（`wrongPending`）が `BRAKE_WRONG=5` 問以上の日は新しい問題を出さない。10問は、間違い最大 `BRAKE_WRONG_SLOTS=7` → 期限が来た正解済みもの → 足りない時だけ残りの間違い → 最後に新問。間違いの並びは、`wrongCount>=HARD_WRONG_MIN(3)` の「固い苦手」を回数の多い順に最大 `HARD_WRONG_MAX(2)` 問先頭、続けて期限の古い順→id。ブレーキの日だけ、選んだ集合は変えずに `orderBrakeDay` で easy（期限が来た正解済み）1つ目 → 固い苦手1 → easy 2つ目 → 固い苦手2 → 残りの間違い → easy の残り → 最後に easy の最後の1つ、の順に並べ替える（足りない分は詰める）。5問未満の日は従来どおり（復習最大5＋新問・固い苦手最大2が先頭）
- `data.js` の問題の任意項目 `hint`（v10〜）：`explain` が「X＝Y なので…」の形の時の前半（例：`1L＝1000mL`）。`gen/make_data.py` が `conv`／`calc_q` から作る。小数が絡む単純換算（倍率が10のべき乗）は後ろに「 ・ 小数点を みぎへ／ひだりへ Nけた」を足し（`decimal_shift_hint`・検算assertつき）、「なので」の形でない number 問題には `HINT_OVERRIDES`（id→hint）で関係式を付ける（検査：hint は＝を含む・choice には付けない・hint に answer+suffix を書かない。問いが定義そのものの t-0069・t-0073 は辺の長さで書いて答えを言わない）。`app.js` は出し直し（`session.attempts[id]>=1`）の時だけ問題文の下に出す
- `taniDrill_guide`（v10〜）＝`{meterText, pxPerCm}`。「みほんの せってい」（1m の見本は20文字まで・1cm の px は30〜90、既定52）。`parseGuideSettings` で検証し、壊れていれば既定値。`taniDrill_guideSeen`＝見本カードを最後に見た日（YYYY-MM-DD・端末の日付）。「わかった」を押した時だけ書き、今日でなければ起動直後にホームでなくカードを出す。どちらも `taniDrill_v1`・バックアップ・復元の対象外。子どもの名前・家族の呼び名は書かない
