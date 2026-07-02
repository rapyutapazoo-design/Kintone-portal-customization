#!/usr/bin/env node
/**
 * generate-template.js
 *
 * 【運用変更】
 * 以前は、本リポジトリ内の適用ファイル（実値入り）から自動でテンプレートを
 * 生成していましたが、実値（アプリID・組織コード・グループコード等）を含む
 * ファイルは本リポジトリから削除し、それぞれの機能開発プロジェクト側
 * （非公開）でのみ管理する方針に変更しました。
 *
 * そのため、`テンプレートフォルダ/` 配下のファイルは自動生成の対象外となり、
 * 直接編集して保守してください。
 *
 * 新たに「実値ファイル→テンプレート」の自動化が必要な機能が増えた場合は、
 * 下記 TARGETS に対象を追加し、transform 関数でプレースホルダー化ロジックを
 * 実装してください（src には、本リポジトリ内 or 参照可能な実値ファイルの
 * パスを指定します）。
 *
 *   node scripts/generate-template.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var TEMPLATE_DIR = path.join(ROOT, 'テンプレートフォルダ');

// --- 対象定義 ---------------------------------------------------------------
// 現在、本リポジトリ内に実値ファイルは存在しないため空。
// 今後、実値ファイルを含む機能を追加する場合はここに定義してください。
var TARGETS = [];

// --- 実行 ---------------------------------------------------------------------

if (TARGETS.length === 0) {
    console.log('対象がありません（テンプレートフォルダ/ は直接編集で保守してください）。');
    process.exit(0);
}

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
