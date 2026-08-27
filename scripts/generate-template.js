#!/usr/bin/env node
/**
 * generate-template.js
 *
 * 【役割】
 *   `本番用フォルダ/`（実値入り・Git管理対象外）を唯一の正として、
 *   `テンプレートフォルダ/`（公開用・プレースホルダー）を機械的に生成する。
 *
 * 【前提】
 *   - 本リポジトリはパブリック。実際のアプリID・スペースID・組織名などの
 *     固有情報は `テンプレートフォルダ/` に含めてはならない。
 *   - `本番用フォルダ/` は .gitignore 済み。編集はこちらに対して行う。
 *   - `テンプレートフォルダ/` は生成物。直接編集しても次回生成で上書きされる。
 *
 * 【安全装置】
 *   生成後の全ファイルを FORBIDDEN_PATTERNS でスキャンし、置換ルールから漏れた
 *   実値を検出した場合はエラー終了する（＝人が気づかなくても公開事故を止める）。
 *
 *   node scripts/generate-template.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var SOURCE_DIR = path.join(ROOT, '本番用フォルダ');
var TEMPLATE_DIR = path.join(ROOT, 'テンプレートフォルダ');

// --- ミラーから除外するもの -----------------------------------------------------
// ビルド成果物・秘密鍵・OSの生成物・ビルドツール本体は公開用に含めない。
var EXCLUDE_NAMES = [
    '.DS_Store',
    'Thumbs.db',
    'node_modules',
    'plugin.zip',            // ビルド成果物（配布はリリース物で行う）
    'scripts',               // ビルドツール本体はリポジトリ直下で管理する
    '.template-rules.json'   // マスク対象語の定義（組織固有情報のため公開しない）
];
var EXCLUDE_EXTENSIONS = ['.ppk']; // Chrome拡張の秘密鍵

// テンプレート側にのみ存在させるファイル（生成時に消さない）。
var TEMPLATE_ONLY = ['README.md'];

// --- 組織固有の文字列（マスク対象）の読み込み ---------------------------------
// 実際のスペース名などはこのスクリプト（＝公開対象）に書かず、
// 本番用フォルダ/.template-rules.json（Git管理対象外）から読み込む。
var RULES_FILE = path.join(SOURCE_DIR, '.template-rules.json');
var maskTerms = [];

function loadMaskTerms() {
    if (!fs.existsSync(RULES_FILE)) {
        console.error('❌ ' + RULES_FILE + ' が見つかりません。');
        console.error('   組織固有の文字列をマスクできないため、生成を中断します。');
        console.error('   maskTerms を定義した .template-rules.json を 本番用フォルダ/ に置いてください。');
        process.exit(1);
    }
    var parsed = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.maskTerms)) {
        console.error('❌ .template-rules.json の maskTerms が配列ではありません。');
        process.exit(1);
    }
    return parsed.maskTerms;
}

/** 正規表現のメタ文字をエスケープする。 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- 置換ルール ---------------------------------------------------------------
// 【重要】ここには実際のID・名称を書かないこと（本ファイルは公開される）。
// 数値部分は \d+ で受け、プレースホルダーへ置き換える汎用パターンのみを定義する。
var REPLACEMENTS = [
    {
        path: 'ショートカットボタン/portal-shortcut.js',
        apply: function (text) {
            // 設定アプリID
            text = text.replace(/var SETTINGS_APP_ID = '\d+';/g,
                "var SETTINGS_APP_ID = 'your-settings-app-id';");
            // appList のアプリID を出現順に your-app-id-1, 2, ... へ置換する
            var n = 0;
            text = text.replace(/\{ id: '\d+', name:/g, function (m) {
                n++;
                return "{ id: 'your-app-id-" + n + "', name:";
            });
            return text;
        }
    },
    {
        path: '問い合わせボタン/inquiry-button.js',
        apply: function (text) {
            return text.replace(/var INQUIRY_APP_ID = '\d+';/g,
                "var INQUIRY_APP_ID = 'your-inquiry-app-id';");
        }
    },
    {
        path: 'スペース設定/space-visibility-filter.js',
        apply: function (text) {
            // ID配列は applyCommonRules() が件数を保って置換する（空配列は温存）。
            // ここでは「N = 名称 / N = 名称 ...」形式のID対応表コメントのみを扱う。
            text = text.replace(/\/\/[^\n]*\d+\s*=[^\n]*\/[^\n]*\d+\s*=[^\n]*/g,
                '//   your-space-id-1 = スペース名1 / your-space-id-2 = スペース名2 ...（実際のIDと名称に書き換えてください）');
            return text;
        }
    }
];

// --- 全ファイル共通の後処理 -----------------------------------------------------
// ドキュメント(.md)内のコード例にも実IDが載るため、ファイル種別を問わず適用する。
function applyCommonRules(text) {
    text = text.replace(/(ALWAYS_KEEP_SPACE_IDS: \[)([^\]]*)(\])/g, function (m, head, body, tail) {
        var count = (body.match(/'\d+'/g) || []).length;
        if (count === 0) return m; // 空配列 [] はそのまま
        var items = [];
        for (var i = 1; i <= count; i++) items.push("'your-space-id-" + i + "'");
        return head + items.join(', ') + tail;
    });
    text = text.replace(/(VISIBLE_SPACE_IDS: \[)([^\]]*)(\])/g, function (m, head, body, tail) {
        var count = (body.match(/'\d+'/g) || []).length;
        if (count === 0) return m;
        var items = [];
        for (var i = 1; i <= count; i++) items.push("'your-space-id-" + i + "'");
        return head + items.join(', ') + tail;
    });
    return text;
}

// --- 生成後に検出したら停止する実値パターン -------------------------------------
// 置換ルールの書き漏れを機械的に検知するための最終防衛線。
// マスク対象語は .template-rules.json から動的に追加する。
var FORBIDDEN_PATTERNS = [
    { name: 'ショートカットのアプリID', re: /\{ id: '\d+'/ },
    { name: '設定アプリID', re: /SETTINGS_APP_ID = '\d+'/ },
    { name: 'お問い合わせアプリID', re: /INQUIRY_APP_ID = '\d+'/ },
    { name: 'スペースIDの実値配列', re: /VISIBLE_SPACE_IDS: \[\s*'\d+'/ },
    { name: '例示コメントの実スペースID', re: /ALWAYS_KEEP_SPACE_IDS: \[\s*'\d+'/ }
];

var SCAN_EXTENSIONS = ['.js', '.css', '.html', '.json', '.md', '.mjs'];

// --- 実行 ---------------------------------------------------------------------

function isExcluded(rawName) {
    var name = toNfc(rawName);
    if (EXCLUDE_NAMES.indexOf(name) !== -1) return true;
    for (var i = 0; i < EXCLUDE_EXTENSIONS.length; i++) {
        if (name.slice(-EXCLUDE_EXTENSIONS[i].length) === EXCLUDE_EXTENSIONS[i]) return true;
    }
    return false;
}

// macOS のファイルシステムは日本語名を NFD（分解済み）で返すため、
// ソース内の NFC 文字列と一致しない。両者を NFC に正規化して比較する。
function toNfc(str) {
    return str.normalize ? str.normalize('NFC') : str;
}

function findReplacement(relPath) {
    var normalized = toNfc(relPath.split(path.sep).join('/'));
    for (var i = 0; i < REPLACEMENTS.length; i++) {
        if (toNfc(REPLACEMENTS[i].path) === normalized) return REPLACEMENTS[i];
    }
    return null;
}

/** 本番用フォルダ配下を再帰的に走査し、テンプレートフォルダへ変換コピーする。 */
function mirror(relDir, stats) {
    var srcDir = path.join(SOURCE_DIR, relDir);
    var destDir = path.join(TEMPLATE_DIR, relDir);
    var entries = fs.readdirSync(srcDir, { withFileTypes: true });

    entries.forEach(function (entry) {
        if (isExcluded(entry.name)) {
            stats.skipped.push(path.join(relDir, entry.name));
            return;
        }
        var relPath = path.join(relDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(path.join(TEMPLATE_DIR, relPath), { recursive: true });
            mirror(relPath, stats);
            return;
        }

        var srcPath = path.join(srcDir, entry.name);
        var destPath = path.join(destDir, entry.name);
        var replacement = findReplacement(relPath);

        var isText = SCAN_EXTENSIONS.indexOf(path.extname(entry.name)) !== -1;
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        if (!isText) {
            // 画像などのバイナリはそのままコピーする
            fs.copyFileSync(srcPath, destPath);
            stats.copied.push(relPath);
            return;
        }

        var raw = fs.readFileSync(srcPath, 'utf8');
        var original = raw;

        if (replacement) {
            raw = replacement.apply(raw);
        }
        raw = applyCommonRules(raw);
        // 組織固有語のマスク（全ファイル共通）
        maskTerms.forEach(function (m) {
            raw = raw.replace(new RegExp(escapeRegExp(m.term), 'g'), m.replacement);
        });
        var changed = (raw !== original);

        fs.writeFileSync(destPath, raw, 'utf8');
        if (changed) {
            stats.transformed.push(relPath);
        } else {
            stats.copied.push(relPath);
        }
    });
}

/** 生成物に実値が残っていないかを走査する。 */
function scanForbidden(relDir, findings) {
    var dir = path.join(TEMPLATE_DIR, relDir);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
        if (entry.name === 'node_modules') return;
        var relPath = path.join(relDir, entry.name);
        if (entry.isDirectory()) {
            scanForbidden(relPath, findings);
            return;
        }
        if (SCAN_EXTENSIONS.indexOf(path.extname(entry.name)) === -1) return;
        var content = fs.readFileSync(path.join(TEMPLATE_DIR, relPath), 'utf8');
        FORBIDDEN_PATTERNS.forEach(function (p) {
            if (p.re.test(content)) {
                findings.push({ file: relPath, pattern: p.name });
            }
        });
    });
}

if (!fs.existsSync(SOURCE_DIR)) {
    console.error('❌ 本番用フォルダ/ が見つかりません: ' + SOURCE_DIR);
    process.exit(1);
}

maskTerms = loadMaskTerms();
maskTerms.forEach(function (m) {
    FORBIDDEN_PATTERNS.push({
        name: '組織固有の名称',
        re: new RegExp(escapeRegExp(m.term))
    });
});
console.log('マスク対象語: ' + maskTerms.length + ' 件（.template-rules.json より読み込み）');

var stats = { copied: [], transformed: [], skipped: [] };
fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
mirror('', stats);

console.log('--- テンプレート生成 ---');
stats.transformed.forEach(function (f) { console.log('  🔁 置換: ' + f); });
console.log('  📄 そのままコピー: ' + stats.copied.length + ' 件');
console.log('  ⏭  除外: ' + stats.skipped.length + ' 件');
console.log('  📌 テンプレート専用（保持）: ' + TEMPLATE_ONLY.join(', '));

var findings = [];
scanForbidden('', findings);

if (findings.length > 0) {
    console.error('\n❌ 生成物に実値が残っています。公開できません。');
    findings.forEach(function (f) {
        console.error('   - ' + f.file + ' : ' + f.pattern);
    });
    console.error('\nREPLACEMENTS に置換ルールを追加してから再実行してください。');
    process.exit(1);
}

console.log('\n✅ 実値スキャン: 検出なし');
console.log('✅ 生成完了: ' + TEMPLATE_DIR);
