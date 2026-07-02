#!/usr/bin/env node
/**
 * generate-template.js
 *
 * 適用ファイル（実値・アプリID/組織コード/グループコードを含む）から、
 * それらをプレースホルダーに置き換えたテンプレートファイルを
 * テンプレートフォルダ/ 配下へ生成する。
 *
 * リポジトリを公開・プッシュする前に、必ず実行してテンプレートを最新化してください。
 *
 *   node scripts/generate-template.js
 *
 * 対応表を増やす場合は、下記 TARGETS に transform 関数を追加してください。
 * transform を省略したファイルは、無変更のままコピーされます
 * （main.js・restriction.css など、固有情報を含まないファイル向け）。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var TEMPLATE_DIR = path.join(ROOT, 'テンプレートフォルダ');

// --- 対象定義 ---------------------------------------------------------------
var TARGETS = [
    {
        src: 'ショトカボタン/portal-shortcut.js',
        dest: 'ショトカボタン/portal-shortcut.js',
        transform: transformPortalShortcut
    },
    {
        src: 'プロフィール閲覧制限/プロフィール閲覧制限カスタマイズ/config.js',
        dest: 'プロフィール閲覧制限/プロフィール閲覧制限カスタマイズ/config.js',
        transform: transformProfileConfig
    },
    {
        // 固有情報なし。そのままコピー（同じフォルダとして完結させるため同梱）。
        src: 'プロフィール閲覧制限/プロフィール閲覧制限カスタマイズ/main.js',
        dest: 'プロフィール閲覧制限/プロフィール閲覧制限カスタマイズ/main.js'
    },
    {
        // 固有情報なし。そのままコピー。
        src: 'プロフィール閲覧制限/プロフィール閲覧制限カスタマイズ/restriction.css',
        dest: 'プロフィール閲覧制限/プロフィール閲覧制限カスタマイズ/restriction.css'
    }
];

// --- 変換ロジック -------------------------------------------------------------

function transformPortalShortcut(content) {
    var appListRegex = /var appList = \[[\s\S]*?\];/;
    if (!appListRegex.test(content)) {
        throw new Error('appList の抽出に失敗しました。portal-shortcut.js の構造が変わっていないか確認してください。');
    }
    var placeholder =
        'var appList = [\n' +
        "            { id: 'your-app-id-1', name: 'アプリ名1' },\n" +
        "            { id: 'your-app-id-2', name: 'アプリ名2' },\n" +
        "            { id: 'your-app-id-3', name: 'アプリ名3' },\n" +
        "            { id: 'your-app-id-4', name: 'アプリ名4' }\n" +
        '        ]; // 実際に配置したいアプリのIDと名称に書き換えてください（行数は自由に増減できます）';
    return content.replace(appListRegex, placeholder);
}

function transformProfileConfig(content) {
    var orgsRegex = /allowedOrgs:\s*\[[^\]]*\]/;
    var groupsRegex = /allowedGroups:\s*\[[^\]]*\]/;
    if (!orgsRegex.test(content) || !groupsRegex.test(content)) {
        throw new Error('allowedOrgs/allowedGroups の抽出に失敗しました。config.js の構造が変わっていないか確認してください。');
    }
    var out = content.replace(orgsRegex, "allowedOrgs: ['YOUR_ORG_CODE']");
    out = out.replace(groupsRegex, "allowedGroups: ['YOUR_GROUP_CODE']");
    return out;
}

// --- 実行 ---------------------------------------------------------------------

var count = 0;
TARGETS.forEach(function (t) {
    var srcPath = path.join(ROOT, t.src);
    var destPath = path.join(TEMPLATE_DIR, t.dest);
    var raw = fs.readFileSync(srcPath, 'utf8');
    var out = t.transform ? t.transform(raw) : raw;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, out, 'utf8');
    console.log('✅ ' + t.dest);
    count++;
});

console.log('\n' + count + ' 件のテンプレートファイルを生成しました: ' + TEMPLATE_DIR);
