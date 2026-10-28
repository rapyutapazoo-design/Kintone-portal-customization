#!/usr/bin/env node
/**
 * generate-template.js
 *
 * 【運用メモ】
 * 実値（アプリID・組織コード・グループコード等）を含むファイルは、Git 管理外の
 * `本番用フォルダ/` に置いて管理します。変更は本番用フォルダで先に行い、実機で
 * 確かめてから、同じ内容を `テンプレートフォルダ/` へプレースホルダーのまま反映します。
 *
 * プレースホルダー化のルールを公開コードに書くと実値が漏れるおそれがあるため、
 * 自動生成は行わず、`テンプレートフォルダ/` は直接編集で保守します。
 *
 * 将来、自動化を実装する場合は、ルールを Git 外の
 * `本番用フォルダ/.template-rules.json` から読み込む設計にしてください
 * （下記 TARGETS に対象を追加し、transform 関数で変換します）。
 *
 *   node scripts/generate-template.js
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var TEMPLATE_DIR = path.join(ROOT, 'テンプレートフォルダ');

// --- 対象定義 ---------------------------------------------------------------
// 自動生成は行わないため空（ヘッダーコメント参照）。
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
