/**
 * 学習アプリのバックアップを受ける Google Apps Script の見本（ウェブアプリとしてデプロイして使う）。
 * 秘密はコードに書かない。次の2つを「スクリプト プロパティ」に登録する。
 *   TOKEN   : 合言葉（アプリの設定欄にも同じ値を入れる）
 *   FOLDERS : JSON 文字列 {"tani-drill":"<フォルダID>", ...}（キーはバックアップJSONの app）
 * リクエスト本文（text/plain の JSON 文字列）: {token, app, kind, content}
 *   kind="backup" : <元>_backup_YYYY-MM-DD.json と <元>_latest.json を上書き保存
 *   kind="test"   : <元>_test.json のみ上書き保存
 * 応答: {"ok":true} または {"ok":false}
 */

/** 日付つき名に使うタイムゾーン */
var TIME_ZONE = "Asia/Tokyo";

/** JSON 応答を作る */
function jsonResponse_(ok) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok })).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** 同名ファイルがあれば中身を上書き、無ければ作る */
function upsertFile_(folder, name, content) {
  var files = folder.getFilesByName(name);
  if (files.hasNext()) {
    files.next().setContent(content);
  } else {
    folder.createFile(name, content, MimeType.PLAIN_TEXT);
  }
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var req = JSON.parse(e.postData.contents);
    if (!req.token || req.token !== props.getProperty("TOKEN")) return jsonResponse_(false);

    var folders = JSON.parse(props.getProperty("FOLDERS") || "{}");
    var folderId = folders[req.app];
    if (!folderId || typeof req.content !== "string") return jsonResponse_(false); // 未登録の app は拒否

    var folder = DriveApp.getFolderById(folderId);
    var base = String(req.app).replace(/-/g, "_");
    if (req.kind === "backup") {
      var day = Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
      upsertFile_(folder, base + "_backup_" + day + ".json", req.content);
      upsertFile_(folder, base + "_latest.json", req.content);
    } else if (req.kind === "test") {
      upsertFile_(folder, base + "_test.json", req.content);
    } else {
      return jsonResponse_(false);
    }
    return jsonResponse_(true);
  } catch (err) {
    return jsonResponse_(false);
  }
}
