/**
 * 学習アプリのバックアップを受ける Google Apps Script の見本（ウェブアプリとしてデプロイして使う）。
 * 秘密はこのファイルに書かない。次の2つを「スクリプト プロパティ」に登録する。
 *   TOKEN   : 合言葉（アプリの設定欄にも同じ値を入れる）
 *   FOLDERS : JSON 文字列 {"tani-drill":"<フォルダID>", ...}（キーはバックアップJSONの app）
 * clasp で配置する場合は、公開リポジトリに置かない別ファイル（config.gs）で
 *   var RECEIVER_CONFIG = { TOKEN: "...", FOLDERS: "{...}" };
 * を定義してもよい（スクリプト プロパティより優先して読む）。
 * リクエスト本文（text/plain の JSON 文字列）: {token, app, kind, content}
 *   kind="backup" : <元>_backup_YYYY-MM-DD.json と <元>_latest.json を上書き保存
 *   kind="test"   : <元>_test.json のみ上書き保存
 *   kind="import_list" : <元>_import_*.json（取り込み待ちのファイル）を古い順に最大10件返す（content は空でよい）
 *                        応答 {"ok":true,"files":[{id,name,content}],"skipped":[name]}
 *   kind="import_done" : content＝ファイルidのJSON配列。同じフォルダ・同じ接頭辞のファイルだけゴミ箱へ送る
 * 応答: {"ok":true} または {"ok":false}
 */

/** 日付つき名に使うタイムゾーン */
var TIME_ZONE = "Asia/Tokyo";

/** 設定値を読む（config.gs の RECEIVER_CONFIG を優先し、無ければスクリプト プロパティ） */
function getSetting_(key) {
  if (typeof RECEIVER_CONFIG !== "undefined" && RECEIVER_CONFIG[key]) return RECEIVER_CONFIG[key];
  return PropertiesService.getScriptProperties().getProperty(key);
}

/** 初回の権限承認用（エディタでこの関数を1回実行し、ドライブへのアクセスを許可する） */
function authorize() {
  DriveApp.getRootFolder();
}

/** 取り込み待ちとして一度に返すファイルの上限 */
var IMPORT_LIST_MAX = 10;

/** JSON 応答を作る（extra があれば項目を足す） */
function jsonResponse_(ok, extra) {
  var body = { ok: ok };
  if (extra) {
    for (var k in extra) body[k] = extra[k];
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** 取り込み待ちのファイル名か（<元>_import_ で始まり .json で終わる） */
function isImportName_(name, base) {
  var prefix = base + "_import_";
  return name.indexOf(prefix) === 0 && name.slice(-5) === ".json";
}

/** 取り込み待ちのファイルを古い順に返す。Googleドキュメント等に変換されたものは読まず名前だけ返す */
function listImports_(folder, base) {
  var found = [];
  var skipped = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || !isImportName_(f.getName(), base)) continue;
    var mime = f.getMimeType();
    if (mime.indexOf("text/") !== 0 && mime !== "application/json") {
      skipped.push(f.getName());
      continue;
    }
    found.push(f);
  }
  found.sort(function (a, b) {
    return a.getDateCreated().getTime() - b.getDateCreated().getTime();
  });
  var files = found.slice(0, IMPORT_LIST_MAX).map(function (f) {
    return { id: f.getId(), name: f.getName(), content: f.getBlob().getDataAsString("UTF-8") };
  });
  return { files: files, skipped: skipped };
}

/** 取り込み済みのファイルをゴミ箱へ送る。同じフォルダ・同じ接頭辞のものだけ（それ以外の id は無視） */
function trashImports_(folder, base, ids) {
  var folderId = folder.getId();
  var trashed = 0;
  ids.forEach(function (id) {
    try {
      var f = DriveApp.getFileById(String(id));
      var parents = f.getParents();
      var inFolder = false;
      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) inFolder = true;
      }
      if (inFolder && isImportName_(f.getName(), base)) {
        f.setTrashed(true);
        trashed += 1;
      }
    } catch (err) {
      // 見つからない id・権限の無い id は飛ばす
    }
  });
  return trashed;
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
    var req = JSON.parse(e.postData.contents);
    if (!req.token || req.token !== getSetting_("TOKEN")) return jsonResponse_(false);

    var folders = JSON.parse(getSetting_("FOLDERS") || "{}");
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
    } else if (req.kind === "import_list") {
      return jsonResponse_(true, listImports_(folder, base));
    } else if (req.kind === "import_done") {
      var ids = JSON.parse(req.content);
      if (!Array.isArray(ids)) return jsonResponse_(false);
      return jsonResponse_(true, { trashed: trashImports_(folder, base, ids) });
    } else {
      return jsonResponse_(false);
    }
    return jsonResponse_(true);
  } catch (err) {
    return jsonResponse_(false);
  }
}
