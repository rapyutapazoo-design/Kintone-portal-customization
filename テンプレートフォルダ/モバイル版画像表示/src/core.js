// =============================================================================
// 共通コア（モバイル限定・document委譲＋祖先フォールバック方式）
//   - PhotoSwipe の初期化（シングルトン）
//   - 画像クリックを document で委譲受けし、グループ単位で拡大表示
//   - グループは「優先候補の祖先」→ 無ければ親要素 にフォールバック（必ず開く）
//   - 除外ゾーン/アイコン/極小画像は対象外
// =============================================================================
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
// PhotoSwipe本体のCSSをビルド時に文字列として取り込む（build.mjs の text ローダー）。
// 起動時に <style> として注入するため、Kintoneへ別途CSSを登録する必要がない。
import photoswipeCss from '../node_modules/photoswipe/dist/photoswipe.css';
import {
  CONFIG,
  CONTENT_ROOTS,
  GROUP_CANDIDATES,
  EXCLUDE_ZONES,
  EXCLUDE_IMG,
} from './config.js';

let lightbox = null;
let styleInjected = false;

// PhotoSwipeのCSSをページへ一度だけ注入する（CSSアップロード不要化）。
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-pswp-style', '1');
  style.textContent = photoswipeCss;
  (document.head || document.documentElement).appendChild(style);
}

// PhotoSwipe lightbox を一度だけ生成して使い回す。
function getLightbox() {
  if (lightbox) return lightbox;
  injectStyle(); // スタイルを先に注入してから初期化する
  lightbox = new PhotoSwipeLightbox({
    pswpModule: PhotoSwipe,
    pinchToClose: true,
    closeOnVerticalDrag: true,
    wheelToZoom: true,
    bgOpacity: 0.92,
    initialZoomLevel: 'fit',
    secondaryZoomLevel: 1.6,
    maxZoomLevel: 4,
  });
  lightbox.init();

  // 保険: primary URL の読み込みに失敗したら fallback（サムネ src）で再読込する。
  // PhotoSwipe公式の loadError イベントを使い、content を作り直して再ロードする。
  lightbox.on('loadError', (e) => {
    const c = e.content;
    const cur = c && c.data && c.data.src;
    const fb = cur && fallbackMap.get(cur);
    if (!fb || fb === cur || c.__kivFellback) return;
    c.__kivFellback = true;
    c.data.src = fb;
    c.element = null;        // 壊れた要素を破棄して作り直す
    c.isAttached = false;
    if (c.slide && c.slide.container) c.slide.container.innerText = ''; // エラー表示を消す
    c.load(false, true);    // fallback URL で再ロード（成功時に自動 append される）
  });

  return lightbox;
}

// 現在のコンテンツ・ルート要素を取得（無ければ body）。
export function getContentRoot() {
  for (const sel of CONTENT_ROOTS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return document.body;
}

// 拡大対象から除外すべき画像か判定する。
function isExcluded(img) {
  if (!img) return true;
  // 除外ゾーン配下
  for (const zone of EXCLUDE_ZONES) {
    if (img.closest(zone)) return true;
  }
  // アイコン・絵文字等
  if (EXCLUDE_IMG && img.closest(EXCLUDE_IMG)) return true;
  // 極小スペーサーの data URI
  const src = img.getAttribute('src') || '';
  if (src.startsWith('data:') && src.length < 256) return true;
  // サイズによるアイコン除外
  const w = img.naturalWidth || img.clientWidth || 0;
  const h = img.naturalHeight || img.clientHeight || 0;
  if (w > 0 && w < CONFIG.iconMinSize && h > 0 && h < CONFIG.iconMinSize) return true;
  return false;
}

// 表示用URLが読めなかったときの代替URL（primary -> fallback）。
const fallbackMap = new Map();

// 拡大表示に使うURLを解決する（primary=表示用 / fallback=保険）。
//   実測（download.do の挙動）に基づく方針:
//     ・レコードのリッチテキスト画像（class に user-token を含む）は、署名URLの
//       仕組み上「表示中のサムネ src（w=NNN）」だけが有効。data-original や w除去・
//       w拡大は 404 になるため、src をそのまま使う。
//     ・掲示板など（user-token 無し）は data-original（原寸）が有効なので優先。
//     ・どの場合も、読み込み失敗時は src（必ず読める）へフォールバックする。
//   ※ URLは「タップ時点」でDOMから参照する（遅延参照）。
function resolveUrls(img) {
  const src = img.currentSrc || img.src || '';

  // レコードのリッチテキスト画像: サムネ src のみが有効
  if (/user-token/.test(img.className || '')) {
    return { primary: src, fallback: src };
  }

  // data-original（原寸）優先
  const original = img.getAttribute('data-original');
  if (original) return { primary: new URL(original, location.href).href, fallback: src };

  // <a> で囲まれた画像リンク
  const a = img.closest('a[href]');
  if (a) {
    const href = a.getAttribute('href') || '';
    if (/\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(href) || /download|file|blob/i.test(href)) {
      return { primary: a.href, fallback: src };
    }
  }

  return { primary: src, fallback: src };
}

// クリックされた画像が属する「グループの基点要素」を決める。
//   優先候補の祖先 → 無ければ画像の親要素（必ず非nullを返す）。
function findGroupRoot(img, contentRoot) {
  for (const sel of GROUP_CANDIDATES) {
    const el = img.closest(sel);
    if (el && contentRoot.contains(el)) return el;
  }
  return img.parentElement || contentRoot;
}

// グループ基点配下の、拡大対象として有効な画像を集める。
function collectImages(groupRoot) {
  return Array.from(groupRoot.querySelectorAll('img')).filter((img) => !isExcluded(img));
}

// 1枚の <img> から PhotoSwipe スライドデータを作る。
function buildSlide(img) {
  const w = img.naturalWidth || img.clientWidth || 1600;
  const h = img.naturalHeight || img.clientHeight || 1200;
  const { primary, fallback } = resolveUrls(img);
  if (primary !== fallback) fallbackMap.set(primary, fallback);
  return {
    src: primary,
    width: w,
    height: h,
    msrc: img.currentSrc || img.src,
    element: img,
    alt: img.alt || '',
  };
}

// クリック画像を起点にグループを構築して開く。
function openFrom(clickedImg, contentRoot) {
  const groupRoot = findGroupRoot(clickedImg, contentRoot);
  let images = collectImages(groupRoot).slice(0, CONFIG.maxImagesPerGroup);
  if (!images.includes(clickedImg)) images = [clickedImg];
  const index = Math.max(0, images.indexOf(clickedImg));
  const dataSource = images.map(buildSlide);
  getLightbox().loadAndOpen(index, dataSource);
}

// 対象画像にズームカーソルを付与（見た目のヒント）。
function markCursor(root) {
  root.querySelectorAll('img').forEach((img) => {
    if (img.getAttribute('data-pswp-cursor') === '1') return;
    if (isExcluded(img)) return;
    img.style.cursor = 'zoom-in';
    img.style.touchAction = 'manipulation';
    img.setAttribute('data-pswp-cursor', '1');
  });
}

// document 委譲でクリックを受け、対象画像なら拡大表示する。
export function enable(contentRoot = getContentRoot()) {
  // capture フェーズで Kintone 既存ハンドラ/リンク遷移より先に拾う。
  document.addEventListener(
    'click',
    (e) => {
      const img = e.target.closest && e.target.closest('img');
      if (!img) return;
      if (!contentRoot.contains(img)) return; // コンテンツ外（ヘッダー等）は無視
      if (isExcluded(img)) return;
      e.preventDefault();
      e.stopPropagation();
      openFrom(img, contentRoot);
    },
    true,
  );

  // 初期カーソル付与 ＋ 動的追加画像へのカーソル付与（debounce）。
  markCursor(contentRoot);
  let timer = null;
  const obs = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      markCursor(contentRoot);
    }, CONFIG.observeDebounceMs);
  });
  obs.observe(contentRoot, { childList: true, subtree: true });
  return obs;
}
