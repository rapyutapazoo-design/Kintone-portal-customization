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

// 戻るボタン連携用の状態（詳細は bindPopState / pushViewerHistory / popViewerHistory を参照）。
let historyPushed = false; // 自分（本カスタマイズ）が履歴を1段積んだか
let isRollingBack = false; // 自分が history.back() を呼んだ直後か（popstateの多重処理防止）
let rollbackTimer = null;
let popStateBound = false; // popstate リスナーの二重登録防止

// PhotoSwipeのCSSをページへ一度だけ注入する（CSSアップロード不要化）。
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-pswp-style', '1');
  style.textContent = photoswipeCss;
  (document.head || document.documentElement).appendChild(style);
}

// タップ位置が「画像上（本画像 or 読み込み中のプレースホルダ）」か判定する。
// .pswp__img クラスは本画像・プレースホルダの双方に付与されるため、
// 読み込み中のサムネ上タップも「画像上」として扱える。
function isTapOnImage(originalEvent) {
  const t = originalEvent && originalEvent.target;
  return !!(t && t.closest && t.closest('.pswp__img'));
}

// 初期ズーム倍率を算出する（画面幅いっぱい表示 ＋ アップスケール上限の適用）。
// zoom は PhotoSwipe の ZoomLevel インスタンス（initialZoomLevel/secondaryZoomLevel/
// maxZoomLevel の各オプション関数から呼ばれる。update() 内の代入順は
// fit→fill→vFill→initial→secondary→max のため、secondary/max 側でも
// この関数を再利用して問題ない）。
function computeInitialZoom(zoom) {
  if (!CONFIG.fillWidthOnOpen) return zoom.fit;
  if (!zoom.elementSize || !zoom.elementSize.x || !zoom.panAreaSize) return zoom.fit;

  // 画面幅いっぱいに広げる倍率
  const fillWidth = zoom.panAreaSize.x / zoom.elementSize.x;
  // 実ピクセルに対する引き伸ばし上限を適用（低解像度画像のボケ防止）
  const capped = Math.min(fillWidth, CONFIG.maxUpscale);
  // 収まり倍率（fit）を下回らせない（変に縮小させない）
  const level = Math.max(zoom.fit, capped);

  // 不正値（0/NaN/Infinity等）は fit にフォールバックする。
  // _getInitial() は falsy を fit にフォールバックするが、NaN は falsy ではないため明示的に潰す。
  if (!Number.isFinite(level) || level <= 0) return zoom.fit;
  return level;
}

// 戻るボタン連携: 開いたときに履歴を1段積む（URLは変えない＝Kintoneのルーティングに影響なし）。
function pushViewerHistory() {
  if (!CONFIG.closeOnBackButton || historyPushed) return;
  try {
    history.pushState({ [CONFIG.historyStateKey]: true }, '', location.href);
    historyPushed = true;
  } catch (e) {
    historyPushed = false;
  }
}

// 戻るボタン連携: ビューアが閉じた側（×ボタン等）から履歴を巻き戻す。
// isRollingBack と rollbackTimer の2つのフラグが必要な理由:
//   ・isRollingBack … 自分が呼んだ history.back() による popstate を、
//     「Kintone側の遷移」と誤認してクローズ処理を二重に走らせないためのガード。
//   ・rollbackTimer … 何らかの理由で popstate が発火しなかった場合に
//     isRollingBack が true のまま固着し、以後の正当な戻る操作を無視してしまう
//     事故を防ぐための保険（タイムアウトで自動解除）。
function popViewerHistory() {
  if (!historyPushed) return;
  historyPushed = false;
  isRollingBack = true;
  if (rollbackTimer) clearTimeout(rollbackTimer);
  rollbackTimer = setTimeout(() => {
    isRollingBack = false;
    rollbackTimer = null;
  }, CONFIG.historyRollbackTimeoutMs);
  history.back();
}

// 戻るボタン／スワイプバックで popstate が発火したときのハンドラを一度だけ登録する。
function bindPopState() {
  if (popStateBound || !CONFIG.closeOnBackButton) return;
  popStateBound = true;
  window.addEventListener('popstate', () => {
    if (isRollingBack) {
      // 自分が呼んだ history.back() の戻り。何もしない。
      isRollingBack = false;
      if (rollbackTimer) {
        clearTimeout(rollbackTimer);
        rollbackTimer = null;
      }
      return;
    }
    if (!historyPushed) return; // 自分が積んだ履歴ではない（Kintone側の遷移）。干渉しない。
    historyPushed = false; // このpopで消費済みにする（destroyでの二重back()を防ぐ）
    const pswp = lightbox && lightbox.pswp;
    if (pswp) pswp.close();
  });
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
    // 画面幅いっぱい表示（アップスケール上限つき）。computeInitialZoom() を参照。
    initialZoomLevel: (zoom) => computeInitialZoom(zoom),
    // 初期倍率と一致するとダブルタップズームが無反応になるため、必ず secondaryZoomFactor(>1) 倍にする。
    secondaryZoomLevel: (zoom) => computeInitialZoom(zoom) * CONFIG.secondaryZoomFactor,
    // ピンチズーム上限。CONFIG.minMaxZoomLevel を下回らないよう保証する。
    maxZoomLevel: (zoom) => Math.max(computeInitialZoom(zoom) * CONFIG.maxZoomFactor, CONFIG.minMaxZoomLevel),
    // タップ位置で「画像上＝コントロール表示切替」「余白＝閉じる」に分岐する。
    // アロー関数にすると this が取れない（this は PhotoSwipe インスタンスである必要がある）ため、
    // 必ず function 式で書く。第2引数が originalEvent（PhotoSwipe仕様）。
    tapAction: function (point, originalEvent) {
      if (isTapOnImage(originalEvent)) {
        // 画像上のタップ = 従来の 'toggle-controls' 相当
        if (this.element) this.element.classList.toggle('pswp--ui-visible');
      } else {
        // 余白のタップ = 閉じる（bgClickAction はマウス操作専用のためタッチでは発火しない）
        this.close();
      }
    },
    // bgClickAction はマウス操作（click イベント）用にPhotoSwipe既定の 'close' のまま残す。
  });
  lightbox.init();

  // 戻るボタン連携: 開くたびに履歴を1段積み、閉じたら必ず巻き戻す。
  lightbox.on('beforeOpen', () => {
    pushViewerHistory();
  });
  // 'close' ではなく 'destroy' を使う（閉じアニメーション完了後の最終処理であり、確実に1回だけ走る）。
  // ×ボタン・余白タップ・ピンチ閉じ・下スワイプ閉じのいずれで閉じても履歴を元に戻す。
  // popstate 経由で閉じた場合は bindPopState() 側で historyPushed=false 済みのため no-op になる。
  lightbox.on('destroy', () => {
    popViewerHistory();
  });
  bindPopState();

  // 画像の読み込み完了時に、暫定寸法（buildSlide参照）を実寸へ差し替えて再レイアウトする。
  // Slide.resize() は「初期倍率のままか非アクティブ」なら再フィット、
  // ユーザーがズーム済みならpan補正のみ、という判定を内部で行うため、
  // 寸法差し替え直後に呼ぶだけで正しく振る舞う（自前でcalculateSize等を呼ぶ必要はない）。
  lightbox.on('loadComplete', (e) => {
    try {
      if (e.isError) return;
      const { content, slide } = e;
      if (!content || !slide) return;
      if (content.type !== 'image') return;
      const el = content.element;
      const nw = el && el.naturalWidth;
      const nh = el && el.naturalHeight;
      if (!nw || !nh) return;
      if (content.width === nw && content.height === nh) return; // 変化なし
      content.width = nw;
      content.height = nh;
      slide.width = nw;
      slide.height = nh;
      // slide.data も更新しないと、スライド再生成・遅延読み込み時に暫定値へ戻ってしまう。
      if (slide.data) {
        slide.data.width = nw;
        slide.data.height = nh;
      }
      slide.resize();
    } catch (err) {
      // 万一失敗してもビューアが開けなくなることを避ける。
      console.warn('[image-viewer] size sync failed', err);
    }
  });

  // 保険: primary URL の読み込みに失敗したら fallback（サムネ src）で再読込する。
  // PhotoSwipe公式の loadError イベントを使い、content を作り直して再ロードする。
  // ※ fallback で再ロードされた場合も onLoaded() → loadComplete が再発火するため、
  //   上記の loadComplete ハンドラが fallback 画像の実寸へ再同期する（意図した動作）。
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
// ここで渡す width/height はあくまで「暫定値」。原寸URLを使う場合は実寸が
// 読み込み完了まで分からないため、サムネのアスペクト比のみを流用して仮置きする。
// 読み込み完了時（loadComplete）に実寸へ更新して再レイアウトする（getLightbox参照）。
// width/height に 0 を渡すと画像の読み込みそのものが始まらないため、必ず正の値にする。
function buildSlide(img) {
  const shownSrc = img.currentSrc || img.src || '';
  const { primary, fallback } = resolveUrls(img);
  if (primary !== fallback) fallbackMap.set(primary, fallback);

  // サムネの実測値からアスペクト比を得る（フォールバックは4:3）。
  const tw = img.naturalWidth || img.clientWidth || 4;
  const th = img.naturalHeight || img.clientHeight || 3;

  // 原寸URL（primary）を使うか、サムネURLそのものを表示するかで寸法解決を分岐する。
  const usesOriginal = primary !== shownSrc;
  let w;
  let h;
  if (usesOriginal) {
    // 原寸URL使用時（掲示板・スペース系）: 実寸は読み込むまで不明なので、
    // アスペクト比のみ流用した暫定寸法（assumedOriginalWidth基準）で開く。
    w = CONFIG.assumedOriginalWidth;
    h = Math.max(1, Math.round((CONFIG.assumedOriginalWidth * th) / tw));
  } else {
    // サムネURLそのもの使用時（リッチテキスト等）: サムネの実ピクセルが真の解像度。
    // これをそのまま渡すことで maxUpscale が正しく効き、ボケ防止の安全弁として機能する。
    w = tw;
    h = th;
  }

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
