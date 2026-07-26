// =============================================================================
// エントリーポイント（モバイル限定）
//   - PC版はKintone標準の画像ビューアに委ねるため、ここで動作を打ち切る。
//   - モバイル(/k/m/)では document委譲で全領域（お知らせ掲示板・スペースの
//     スレッド・レコードのリッチテキスト）の画像をタップ拡大表示する。
//   - 全体カスタマイズの「スマートフォン用」スロットに1登録するだけで動作。
// =============================================================================
import { CONFIG } from './config.js';
import { enable, getContentRoot } from './core.js';

// モバイル判定。テスト用に window.__KIV_FORCE__ = true で強制有効化できる。
function isMobile() {
  if (window.__KIV_FORCE__) return true;
  return location.pathname.startsWith(CONFIG.mobilePathPrefix);
}

function boot() {
  if (!isMobile()) return; // PCでは何もしない（標準ビューアを尊重）
  try {
    enable(getContentRoot());
  } catch (e) {
    console.error('[image-viewer] failed to enable', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
