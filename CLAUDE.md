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
- `summary`＝読む用：`masteredCount`/`totalCount`、`stages`（段階別の total・mastered）、`weak`（間違い回数の多い順に最大10件）、`recentDays`（直近14日の出した数・1回目正解数・まちがい id）。`state`＝復元用（`ふくげん`で読み戻す）
- `taniDrill_lastBackup`（ホームの「ほぞんしよう」促し7日）＝受け口が ok を返した日、または共有/ダウンロードを**実行した日**。Driveに入った保証は受け口 ok の時のみ
- `taniDrill_driveSync`＝`{url, token}` のJSON。`taniDrill_v1`・`STATE_VERSION` とは別キー。値をコード・ログ・コミットに書かない
- 受け口の実体は Apps Script「学習アプリ受け口」（3アプリ共用）。Mac の `~/gas/learning-apps-receiver/` から clasp（`npx @google/clasp@3.4.1`）で `push` → `create-deployment -i <既存ID>` で同じURLのまま更新する。秘密（`config.gs`・`.token`・`.url`）はそのフォルダだけに置く
- 形式を変える時は `format` を上げ、`parseBackup` を直す（`BACKUP_APP_ID`・`STATE_VERSION` の確認あり）
- 復元前の退避は `taniDrill_v1_restore_<日付>[_n]`（新しい2本だけ残る）。`taniDrill_v1_backup_` は壊れたデータの控えで、刈り込みの対象外
