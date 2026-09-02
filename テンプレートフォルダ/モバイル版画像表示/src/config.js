// =============================================================================
// 設定（セレクタ・閾値）
// -----------------------------------------------------------------------------
// 動作対象は「モバイル版のみ」。PC版はKintone標準の画像ビューアに委ねるため
// このスクリプトは一切動作しません（index.js のモバイルガード参照）。
//
// Kintoneの内部DOM構造は非公開仕様のため、アップデートで class 名が変わること
// があります。動かなくなった場合は、まずこのファイルのセレクタだけを調整して
// ください（本体 core.js は触らずに復旧できる設計です）。
// =============================================================================

export const CONFIG = {
  // モバイル判定: この接頭辞配下のURLでのみ動作する。
  mobilePathPrefix: '/k/m/',

  // アイコン・絵文字・アバター等を除外する最小サイズ（px）。
  // 表示/自然サイズのどちらもこれ未満なら拡大対象にしない。
  iconMinSize: 56,

  // 1グループ（スワイプ送り単位）に束ねる画像数の安全上限。
  maxImagesPerGroup: 200,

  // MutationObserver の再走査をまとめる debounce（ms）。カーソル付与用。
  observeDebounceMs: 200,

  // 開いた瞬間に画面幅いっぱいで表示するか。
  // false にすると PhotoSwipe 既定の fit（はみ出さない収まり）に戻る緊急退避スイッチ。
  fillWidthOnOpen: true,

  // 画像の実ピクセルに対する引き伸ばし上限倍率。
  // 低解像度サムネ（リッチテキストの約250px）を画面幅まで引き伸ばしてボケさせないための安全弁。
  maxUpscale: 2,

  // ダブルタップ時のズーム倍率（初期倍率の何倍か）。
  // 初期倍率と一致するとダブルタップズームが無効化されるため必ず 1 より大きくする。
  secondaryZoomFactor: 2,

  // ピンチズームの上限（初期倍率の何倍か）。
  maxZoomFactor: 4,

  // ズーム上限の下限値（原寸比）。従来の maxZoomLevel: 4 相当を保証する。
  minMaxZoomLevel: 4,

  // 原寸URL（data-original等）を使う場合、読み込み完了まで実寸が分からないため、
  // サムネのアスペクト比を流用して仮置きする幅（px）。
  assumedOriginalWidth: 1600,

  // 端末の戻るボタン／スワイプバックでビューアを閉じる（history.pushState連携）を有効にするか。
  closeOnBackButton: true,

  // history.pushState で積む state の目印キー。
  // Kintone側や他カスタマイズの履歴と取り違えないために使う。
  historyStateKey: '__kivViewer',

  // history.back() 後に popstate が来なかった場合に、
  // ロールバック中フラグを解除するまでの待ち時間（ms）。
  historyRollbackTimeoutMs: 600,
};

// -----------------------------------------------------------------------------
// コンテンツ・ルート（この配下の画像だけを対象にする）
//   モバイルのメインコンテンツは #container。存在しなければ body にフォールバック。
// -----------------------------------------------------------------------------
export const CONTENT_ROOTS = ['#container'];

// -----------------------------------------------------------------------------
// グループ（スワイプ送り単位）の優先候補
//   クリックした画像から最も近い祖先を上から順に探し、最初に見つかったものを
//   1ギャラリーとして束ねる。いずれにも該当しなければ画像の親要素を1グループ扱い。
//     ① レコードのリッチテキストフィールド
//     ② スペースのスレッド/コメント
//     ③ お知らせ（掲示板）記事ブロック
// -----------------------------------------------------------------------------
export const GROUP_CANDIDATES = [
  // ① レコードのフィールド（リッチテキスト等）
  //    モバイルのリッチテキスト容器は control-editor-gaia / control-value-gaia / control-gaia
  '[class*="control-editor"]',
  '[class*="control-value"]',
  '.control-gaia',
  '.control-multilinetext-field-gaia',
  '.control-rich_text-field-gaia',
  '[class*="rich-editor"]',
  '[class*="rich-text"]',
  '[class*="multilinetext"]',
  // ② スペースのスレッド/コメント
  '.gaia-argoui-space-thread-comment',
  '.gaia-argoui-thread-comment',
  '[class*="thread"] [class*="comment"]',
  '[class*="comment-body"]',
  // ③ お知らせ（掲示板）記事ブロック
  //    モバイルv2は gaia-mobile-v2-portal-announcement... 系
  '[class*="announcement"]',
  '[class*="notification"]',
  '[class*="bulletin"]',
  'article',
  'li',
];

// -----------------------------------------------------------------------------
// 除外ゾーン（この配下の画像は拡大対象にしない）
//   ヘッダー/ナビ、アプリショートカット、スペースカバー、アイコン類など。
// -----------------------------------------------------------------------------
export const EXCLUDE_ZONES = [
  '.mobile-header-global-navigation-container',
  '[class*="header-global-navigation"]',
  '[class*="global-navigation"]',
  '[class*="portal-header"]',
  // 装飾用のポータル先頭スライドショーのみ除外する。
  // ※添付画像のサムネ（gaia-ui-slideshow-thumbnail / ocean-attached-file）は
  //   "slideshow" を含むが拡大対象なので、ここで広く除外しないこと。
  '[class*="cybozu-ui-slideshow"]',
  '[id*="banner-root"]',
  '[class*="app-shortcut"]',
  '[class*="appsmenu"]',
  '[class*="favorite"]',
  '[class*="space-cover"]',
  // レコードの「添付ファイル」フィールド（掲示板/スレッド/リッチテキストとは別のDOM構造）。
  // サムネイルは a.control-value-item-gaia が record/download.do への直リンクを持つ、
  // Kintone標準の値アイテム構造。ここではKintone標準ビューアーを尊重し、対象外にする。
  'a[href*="/k/api/record/download.do"]',
  '.pswp', // PhotoSwipe自身のDOM
];

// 画像そのものに対する除外セレクタ（アイコン・絵文字・アバター・メンション等）。
export const EXCLUDE_IMG = [
  '[class*="user-icon"]',
  '[class*="avatar"]',
  '[class*="emoji"]',
  '[class*="icon"]',
  '[class*="reaction"]',
  '[class*="mention"]',
].join(',');
