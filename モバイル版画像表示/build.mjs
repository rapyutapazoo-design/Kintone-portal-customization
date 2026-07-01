// ビルドスクリプト: src/index.js ＋ PhotoSwipe(JS) ＋ PhotoSwipe(CSS) を 1 ファイルに
// バンドルする。CSSはJSへ取り込み、起動時に <style> として自動注入される。
// 出力: dist/kintone-image-viewer.bundle.js（Kintoneに「JavaScript」として登録。これ1つでOK）
//       dist/photoswipe.css         （参考用コピー。CSSは同梱済みのため登録不要）
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, 'dist');
const watch = process.argv.includes('--watch');

await mkdir(dist, { recursive: true });

const options = {
  entryPoints: [resolve(__dirname, 'src/index.js')],
  bundle: true,
  format: 'iife',          // Kintoneは通常スクリプトとして読み込むためIIFEで自己完結させる
  target: ['es2019'],      // モバイルブラウザ互換性のため控えめに
  minify: true,
  legalComments: 'none',
  loader: { '.css': 'text' }, // CSSを文字列として取り込み、JSへ同梱する
  outfile: resolve(dist, 'kintone-image-viewer.bundle.js'),
  logLevel: 'info',
};

// PhotoSwipe本体のCSSをdistへコピー（Kintoneに別途CSSとして登録する）
const copyCss = async () => {
  await copyFile(
    resolve(__dirname, 'node_modules/photoswipe/dist/photoswipe.css'),
    resolve(dist, 'photoswipe.css'),
  );
  console.log('copied photoswipe.css -> dist/');
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  await copyCss();
  console.log('watching...');
} else {
  await esbuild.build(options);
  await copyCss();
  console.log('build done -> dist/');
}
