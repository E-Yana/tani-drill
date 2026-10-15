# たんいドリル（小4）— このアプリの説明（Claude向け）

小学4年生の「単位」練習アプリ（長さ・重さ・かさ・時間・面積）。iPadで使う。公開サイト: https://e-yana.github.io/tani-drill/
子どもの学習記録はiPadの中（localStorage `taniDrill_v1`）にしか無く、外から書き込めない。
全100問・7段階。出題・採点・保存形式は `logic.js`（`window.TaniLogic`）、問題は `data.js`、画面は `app.js`。

## 問題を足す・直す手順
1. `gen/make_data.py` の問題定義を直す。**id は各問題にソースで固定**。一度使った id は変えない・使い回さない（直したいときも同じ id のまま中身を直す。足すときは次の番号）
2. number の問題は検算（`Decimal`）が必須。choice は3択・重複なし・answer を含む
3. `python3 gen/make_data.py data.js` で生成する（既存の id が消えると失敗終了する）
4. `node gen/test_logic.js` でテストを通す
5. `app.js` の `APP_VERSION` と `sw.js` の `CACHE` を対で上げる
6. コミットして公開する

## 守ること
- `app.js` の `APP_VERSION` と `sw.js` の `CACHE`（`tani-drill-vN`）は対で上げる
- `data.js` を手で直さない（必ず `gen/make_data.py` から生成）
- 問題の id を変えない・再利用しない
- 公開リポジトリなので、子どもの名前・学校名・住所などは書かない
- 5年の先取り（体積・L と cm³・速さ・小数×小数・小数÷小数）を入れない
