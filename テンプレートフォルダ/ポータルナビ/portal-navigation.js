/**
 * portal-navigation.js
 * Kintone ポータルナビ統合版（PC・モバイル共通）。
 * 旧 mobile-home-button.js（ホームボタン）と旧 portal-shortcut.js（ショートカットボタン・
 * 色/形変更・個人カスタマイズ・端末間同期）の2ファイルを1ファイルにまとめ、
 * そこへ「全体設定（管理者が全ユーザーの既定値を決める）」と「管理者設定画面」を加えたもの。
 *
 * 【重要な注意】
 *   - 旧2ファイルと同時に登録しないこと。先に読まれた側だけが描画し、後から読まれた側は
 *     重複を避けて何もしない（統合ファイルが後に読まれた場合はコンソールに警告を出す）。
 *     切り替え時は「JavaScript / CSS でカスタマイズ」で旧2ファイルの登録を外す。
 *   - 書き換えが必要な固有値は次の2つだけ。
 *       SETTINGS_APP_ID         ... 個人設定アプリ（端末間同期用）のアプリID
 *       GLOBAL_SETTINGS_APP_ID  ... 全体設定アプリ（管理者の既定値用）のアプリID
 *     どちらも数字以外（プレースホルダー）のままなら、その機能を丸ごと無効にして動く
 *     （リモートAPIは一切呼ばず、JS内の既定値 appList・navy・capsule・丸 で動作する）。
 *     appList の id も実際のアプリIDに書き換える（テンプレートでは your-app-id-N）。
 *   - 管理者パスワードはブラウザの中で照合する補助的な鍵であり、本当の防御ではない。
 *     開発者ツールを使えば、画面側のパスワード照合やロックは回避できる。
 *     本当の防御は、全体設定アプリの kintone アプリ権限・フィールド権限である。
 *
 * 【ファイルの構成】
 *   共通部（全体設定の取得・TTL キャッシュ・優先順位の解決・タップ演出）／
 *   ショートカット部（window.PortalCustomize を維持）／ホームボタン部／管理者画面部
 *   （⚙️ → 「🔒 管理者設定」を開いたときに初めて DOM と CSS を作る）。
 *
 * 【共有コーディネーター】
 *   window.PortalCustomize として、ポータル上部のコンテナとマウントスロットを提供する。
 *   - 冪等（idempotent）初期化: 何度呼んでもコンテナは1度しか生成しない。
 *   - DOM ID: 'my-custom-app-container' / 'portal-customize-config' / 'mobile-home-shortcut'
 *   - スロット1=ショートカットボタン群 addShortcutItem(el)、スロット2=デザイン設定（🎨）・個人設定（⚙️）ボタン
 *     addConfigItem(el)、スロット3=フォントボタン群（font-size-changer.js が
 *     getConfigContainer() 経由で右寄せにマウントする。本ファイルは触れない）。
 *   ※ フォント設定（localStorage キー・kintone-font-size-changed イベント）はフォント側の所有物。
 *
 * 【優先順位】個人設定 → 全体設定 → JS内の最終既定値
 *   管理者が「強制反映」を付けて保存したときだけ、それより前の個人設定を無効にする。
 *   shortcutsForceRev と designForceRev を別々に持つ。比較には論理的な改訂番号 settingsRev を使い、
 *   個人設定は保存時の settingsRev を baseRev として覚える（baseRev < ForceRev なら無効）。
 *   同時編集の検出には kintone レコードの $revision を使う（PUT の revision に指定する）。
 *
 * 【全体設定アプリ（レコードは常に1件。$id が最小のものを使う）】
 *   settings_json（文字列・複数行。全員が閲覧、管理者が編集）:
 *     { "schemaVersion":1, "settingsRev":13,
 *       "shortcuts":[{"type":"app|space","targetId":"…","targetName":"…","label":"…","labelCustom":false}],
 *       "design":{"scTheme":"navy|green|purple|standard","scShape":"capsule|rounded",
 *                 "homeTheme":"navy|green|purple|standard","homeShape":"circle|rounded"},
 *       "shortcutsForceRev":0, "designForceRev":0, "updatedBy":"表示名", "updatedAt":"ISO8601" }
 *     ※ homeTheme/homeShape は scTheme/scShape からの派生値を保存する（読み込み時は無視。旧版との互換用）
 *     shortcuts は 4〜6 件。settingsRev は管理者が保存するたびに +1 する。
 *   auth_json（文字列・複数行。フィールド権限で管理者だけが閲覧・編集）:
 *     { "v":1, "alg":"PBKDF2-SHA256", "iter":100000, "salt":"<base64 16バイト>",
 *       "hash":"<base64 32バイト>", "updatedBy":"…", "updatedAt":"ISO8601" }
 *   個人設定アプリの JSON には baseRev（0以上の整数。旧データは 0）が追記される。
 *   旧ファイルが読んでも未知のキーとして無視されるため互換性は保たれる。
 *
 * 【localStorage / sessionStorage のキー一覧】
 *   kintone_portal_shortcuts_<userId>        localStorage   個人ショートカットのJSON（baseRev を追記）。ID不明時は _default
 *   kintone_portal_shortcuts_mode_<userId>   localStorage   'app' か 'local'（既存・無変更）
 *   kintone_portal_theme_idx                 localStorage   THEMES の添字（既存・無変更）
 *   kintone_portal_shape_idx                 localStorage   SHAPES の添字（既存・無変更）
 *   kintone_portal_home_theme_idx            localStorage   旧: ホームボタンの色。現在は読まない（🎨 で保存・既定に戻す時に削除）
 *   kintone_portal_design_rev                localStorage   🎨 のデザイン設定を最後に保存した時点の settingsRev（無ければ0。新規）
 *   kintone_portal_global_settings_v1        localStorage   全体設定のキャッシュ（最長10分。新規）
 *   kintone_portal_admin_lock_<userId>       localStorage   {"fails":n,"until":ms}（パスワード失敗のロック。新規）
 *   kintone_portal_admin_auth_<userId>       sessionStorage {"appId":"..","until":ms}（認証の有効期限30分。新規）
 *   kintone_portal_admin_acl_<userId>        sessionStorage 管理者権限の判定結果のキャッシュ（新規）
 *   ※ フォント側のキー（kintone-custom-font-size など）には触れない。
 *
 * 【個人カスタマイズ（⚙️）】
 *   ショートカットの遷移先（アプリ・スペース）・表示名・並び順・個数をユーザー本人が編集できる。
 *   設定は localStorage にログインユーザー単位でキャッシュされる。設定スキーマは v2
 *   （{type, targetId, targetName, label, labelCustom}）。v1 は読み込み時に v2 へ自動移行する。
 *
 * 【端末間同期（任意）】
 *   個人設定アプリ（フィールド: login_name / settings_json）で「すべての端末で共有／この端末だけ」を選べる。
 *   SETTINGS_APP_ID がプレースホルダーのままなら同期は無効（localStorage のみ）。
 */
(function () {
    "use strict";

    // 同じファイルが2回登録された場合は、2回目以降を無視する（イベントの二重登録を防ぐ）
    if (window.PortalNavigation && window.PortalNavigation.loaded === true) {
        console.warn('portal-navigation: 二重に読み込まれたため2回目以降を無視します');
        return;
    }

    // ============================================================
    // 1. 定数
    // ============================================================
    var CONTAINER_ID = 'my-custom-app-container';
    var CONFIG_ID = 'portal-customize-config';
    var PORTAL_EVENTS = ['portal.show', 'mobile.portal.show'];

    // --- ショートカット用 定数 ---
    // base / tint は設定モーダルのテーマ連動用の派生色（単色）。
    // grad / shadow はショートカットボタン本体が使う既存の値であり、変更しないこと。
    // homeGrad / homeShadow はホームボタン用（navy は旧 mobile-home-button.js と同じ値）。label は管理者画面の表示名。
    var THEMES = [
        { name: 'navy', label: 'ネイビー', grad: 'linear-gradient(135deg, #154260 0%, #2b7bc0 100%)', shadow: '0 4px 10px rgba(21, 66, 96, 0.4)', base: '#154260', tint: '#dbe9f5',
          homeGrad: 'linear-gradient(135deg, #2b7bc0 0%, #154260 100%)', homeShadow: '0 4px 12px rgba(21, 66, 96, 0.4)' },
        { name: 'green', label: 'グリーン', grad: 'linear-gradient(135deg, #134E5E 0%, #71B280 100%)', shadow: '0 4px 10px rgba(19, 78, 94, 0.4)', base: '#134E5E', tint: '#d9ebe4',
          homeGrad: 'linear-gradient(135deg, #71B280 0%, #134E5E 100%)', homeShadow: '0 4px 12px rgba(19, 78, 94, 0.4)' },
        { name: 'purple', label: 'パープル', grad: 'linear-gradient(135deg, #4b134f 0%, #c94b4b 100%)', shadow: '0 4px 10px rgba(75, 19, 79, 0.4)', base: '#4b134f', tint: '#ecdcee',
          homeGrad: 'linear-gradient(135deg, #c94b4b 0%, #4b134f 100%)', homeShadow: '0 4px 12px rgba(75, 19, 79, 0.4)' },
        { name: 'standard', label: 'スタンダード', grad: '#3498db', shadow: '0 4px 10px rgba(52, 152, 219, 0.4)', base: '#2d80b8', tint: '#dbeaf6',
          homeGrad: 'linear-gradient(#3498db, #3498db)', homeShadow: '0 4px 12px rgba(52, 152, 219, 0.4)' }
    ];
    var SHAPES = [
        { name: 'capsule', label: 'カプセル', radius: '30px' },
        { name: 'rounded', label: '角丸', radius: '8px' }
    ];

    // --- 個人カスタマイズ 用 定数 ---
    var MIN_SHORTCUTS = 4;
    var MAX_SHORTCUTS = 6;
    var SETTINGS_SCHEMA_VERSION = 2;
    var SETTINGS_SCHEMA_VERSION_LEGACY = 1; // v1 読み込み許容用（読み込み時に自動移行する）
    var TARGET_TYPE_APP = 'app';
    var TARGET_TYPE_SPACE = 'space';
    var SPACE_ID_PATTERN = /\/space\/(\d+)/;
    var SPACE_FETCH_CONCURRENCY = 5;
    var SPACE_FETCH_MAX = 60;
    var STORAGE_KEY_PREFIX = 'kintone_portal_shortcuts';
    var STORAGE_KEY_FALLBACK = 'kintone_portal_shortcuts_default';
    var BTN_MARKER_ATTR = 'data-shortcut-btn'; // ショートカットボタン再描画時の削除対象マーカー（data-shortcut-renderedとは別物）
    var MODAL_STYLE_ID = 'portal-shortcut-modal-style';
    var TAP_STYLE_ID = 'portal-shortcut-tap-style';
    var MIN_PRESS_MS = 120;
    var NAV_FAILSAFE_MS = 10000;

    // --- 端末間同期（設定アプリ方式） 用 定数 ---
    // SETTINGS_APP_ID はプレースホルダー。実値版ファイルで実際のアプリIDに書き換えて使う。
    // プレースホルダーのままなら isSyncAvailable() が false を返し、同期機能一式が無効化される。
    var SETTINGS_APP_ID = 'your-settings-app-id';
    var FIELD_LOGIN_NAME = 'login_name';         // 文字列1行・重複禁止（ログインユーザーのログイン名）
    var FIELD_SETTINGS_JSON = 'settings_json';   // 文字列複数行（設定JSON文字列）
    var STORAGE_MODE_KEY_PREFIX = 'kintone_portal_shortcuts_mode'; // 保存先モードの localStorage キー（端末ごと）
    var SYNC_MODE_APP = 'app';     // すべての端末で共有する（既定）
    var SYNC_MODE_LOCAL = 'local'; // この端末だけに保存する

    // --- 配置するアプリ一覧（管理者既定値。ユーザーが ⚙️ で未設定の場合にこの内容が表示される） ---
    // 【重要】本リポジトリはパブリックのため、id は your-app-id-N のプレースホルダーのまま維持している。
    // 実際のアプリIDは非公開の実値版ファイル（各機能の開発プロジェクト側）にのみ記入すること。
    var appList = [
        { id: 'your-app-id-1', name: '管理規約' },   // 実IDは非公開の実値版ファイルに記入
        { id: 'your-app-id-2', name: '意見書' },     // 実IDは非公開の実値版ファイルに記入
        { id: 'your-app-id-3', name: '施設予約' },   // 実IDは非公開の実値版ファイルに記入
        { id: 'your-app-id-4', name: 'カレンダー' }  // 実IDは非公開の実値版ファイルに記入
    ]; // 実際に配置したいアプリのIDと名称に書き換えてください（行数は自由に増減できます）

    // --- ホームボタン 用 定数 ---
    var HOME_EVENTS = ['mobile.app.record.index.show', 'mobile.app.record.detail.show', 'mobile.space.portal.show'];
    var HOME_URL = '/k/m/';                             // モバイル版ポータルURL（固定）
    var HOME_BTN_ID = 'mobile-home-shortcut';           // 旧 mobile-home-button.js と同じID（重複生成の防止に使う）
    var HOME_TAP_STYLE_ID = 'mobile-home-button-tap-style'; // 旧ファイルと同じID（CSSの二重注入を防ぐ）
    var HOME_SHAPES = [
        { name: 'circle', label: '丸', radius: '50%' },
        { name: 'rounded', label: '角丸', radius: '16px' }
    ];
    var HOME_SVG =
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z" fill="white"/>' +
        '</svg>';
    var NAV_MARKER_ATTR = 'data-portal-nav'; // 統合ファイルが作ったDOMに付ける印（旧ファイルが作ったものと区別する）

    // --- 色・形の最終既定値（JS内の既定値） ---
    // home* は scTheme/scShape からの派生値（resolveDesign / withDerivedHome と一致させる）
    var DEFAULT_DESIGN = { scTheme: 'navy', scShape: 'capsule', homeTheme: 'navy', homeShape: 'circle' };

    // --- 全体設定（管理者の既定値）用 定数 ---
    // GLOBAL_SETTINGS_APP_ID はプレースホルダー。全体設定アプリのIDに書き換えて使う。
    // 数字以外（プレースホルダー）のままなら isGlobalAvailable() が false を返し、全体設定と管理者設定が無効になる。
    var GLOBAL_SETTINGS_APP_ID = 'your-global-settings-app-id';
    var FIELD_GLOBAL_SETTINGS = 'settings_json';  // 文字列複数行（全体設定のJSON）
    var FIELD_GLOBAL_AUTH = 'auth_json';          // 文字列複数行（管理者パスワードのハッシュ。フィールド権限で管理者だけに公開）
    var GLOBAL_SCHEMA_VERSION = 1;
    var GLOBAL_CACHE_TTL_MS = 10 * 60 * 1000;     // 全体設定のキャッシュ有効期間（最長10分で他の利用者へ反映）
    var AUTH_SESSION_MS = 30 * 60 * 1000;         // 管理者認証の有効期間
    var AUTH_MAX_FAILS = 5;                       // パスワードを連続で間違えられる回数
    var AUTH_LOCK_MS = 5 * 60 * 1000;             // 上限に達したときのロック時間
    var PBKDF2_ITERATIONS = 100000;
    var PBKDF2_SALT_BYTES = 16;
    var PBKDF2_HASH_BYTES = 32;
    var PASSWORD_MIN_LENGTH = 8;
    var ADMIN_STYLE_ID = 'portal-nav-admin-style';
    var DESIGN_STYLE_ID = 'portal-nav-design-style';

    // --- localStorage / sessionStorage のキー（一覧はファイル先頭のコメント参照） ---
    var KEY_THEME_IDX = 'kintone_portal_theme_idx';
    var KEY_SHAPE_IDX = 'kintone_portal_shape_idx';
    var KEY_HOME_THEME_IDX = 'kintone_portal_home_theme_idx'; // 旧キー（ホームボタンの色）。読まない。掃除専用
    var KEY_DESIGN_REV = 'kintone_portal_design_rev';
    var KEY_GLOBAL_CACHE = 'kintone_portal_global_settings_v1';
    var KEY_ADMIN_LOCK_PREFIX = 'kintone_portal_admin_lock_';
    var KEY_ADMIN_AUTH_PREFIX = 'kintone_portal_admin_auth_';
    var KEY_ADMIN_ACL_PREFIX = 'kintone_portal_admin_acl_';
    var ADMIN_ACL_TTL_MS = 10 * 60 * 1000;

    // ============================================================
    // 2. 共通ユーティリティ
    // ============================================================
    function lsRef() {
        try { return window.localStorage; } catch (e) { return null; }
    }
    function ssRef() {
        try { return window.sessionStorage; } catch (e) { return null; }
    }

    /** Storage の安全ラッパー。失敗（プライベートモード等）しても例外を出さず、null / 何もしないで返す。 */
    function storageGet(storage, key) {
        try { return storage ? storage.getItem(key) : null; } catch (e) { return null; }
    }
    function storageSet(storage, key, value) {
        try { if (!storage) return false; storage.setItem(key, value); return true; } catch (e) { return false; }
    }
    function storageRemove(storage, key) {
        try { if (storage) storage.removeItem(key); } catch (e) { /* 無視 */ }
    }
    function lget(key) { return storageGet(lsRef(), key); }
    function lset(key, value) { return storageSet(lsRef(), key, value); }
    function lremove(key) { storageRemove(lsRef(), key); }
    function sget(key) { return storageGet(ssRef(), key); }
    function sset(key, value) { return storageSet(ssRef(), key, value); }
    function sremove(key) { storageRemove(ssRef(), key); }

    function getUserId() {
        try {
            var user = kintone.getLoginUser();
            if (user && user.id) return String(user.id);
        } catch (e) {
            // 既定へ
        }
        return 'default';
    }

    function getLoginName() {
        try {
            var user = kintone.getLoginUser();
            if (user && user.code) return user.code;
        } catch (e) {
            // 取得不可
        }
        return null;
    }

    function getUserDisplayName() {
        try {
            var user = kintone.getLoginUser();
            if (user && user.name) return user.name;
            if (user && user.code) return user.code;
        } catch (e) {
            // 取得不可
        }
        return '';
    }

    /** モバイル版の画面（/k/m/ 配下。ゲストスペース /k/guest/<id>/m/ を含む）かどうか。 */
    function isMobilePath(pathname) {
        return (/^\/k\/(guest\/\d+\/)?m(\/|$)/).test(String(pathname || ''));
    }

    /** 0以上の有限な数値ならそのまま、そうでなければ 0。 */
    function toRevNumber(v) {
        return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 0;
    }

    function removeAllChildren(el) {
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    function adminEl(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text; // 文字列は必ず textContent で入れる（XSS 対策）
        return e;
    }

    /**
     * localStorage に保存された添字から要素を取り出す。
     * 未設定・数値でない・範囲外の場合は先頭要素にフォールバックする。
     */
    function pickByStoredIndex(list, storageKey) {
        var idx = 0;
        var parsed = parseInt(lget(storageKey), 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < list.length) {
            idx = parsed;
        }
        return list[idx];
    }

    /**
     * テーマの grad を background-image として使える値に正規化する。
     * standard テーマの grad は単色（#3498db）であり、そのままでは background-image に
     * 指定できず宣言ごと無効になる（＝白背景に白文字で読めなくなる）。
     * 単色の場合はフラットな linear-gradient に包んで返す。
     */
    function toBackgroundImage(grad) {
        if (grad && grad.indexOf('gradient') !== -1) return grad;
        return 'linear-gradient(' + grad + ', ' + grad + ')';
    }

    function themeIndexByName(name) {
        for (var i = 0; i < THEMES.length; i++) if (THEMES[i].name === name) return i;
        return 0;
    }
    function shapeIndexByName(name) {
        for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].name === name) return i;
        return 0;
    }
    function homeShapeByName(name) {
        for (var i = 0; i < HOME_SHAPES.length; i++) if (HOME_SHAPES[i].name === name) return HOME_SHAPES[i];
        return HOME_SHAPES[0];
    }
    /** ショートカットの形からホームボタンの形を決める（rounded→rounded、それ以外→circle）。 */
    function homeShapeNameForScShape(scShape) {
        return scShape === 'rounded' ? 'rounded' : 'circle';
    }
    /** ホームボタンの色・形をショートカットの色・形から派生させたデザインを返す（純関数）。 */
    function withDerivedHome(design) {
        return {
            scTheme: design.scTheme,
            scShape: design.scShape,
            homeTheme: design.scTheme,
            homeShape: homeShapeNameForScShape(design.scShape)
        };
    }
    function isThemeName(name) {
        for (var i = 0; i < THEMES.length; i++) if (THEMES[i].name === name) return true;
        return false;
    }
    function isShapeName(name) {
        for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].name === name) return true;
        return false;
    }
    function isHomeShapeName(name) {
        for (var i = 0; i < HOME_SHAPES.length; i++) if (HOME_SHAPES[i].name === name) return true;
        return false;
    }

    // ============================================================
    // 3. タップ演出（共通。ショートカット側は pst-、ホームボタン側は mhb- の接頭辞）
    // ============================================================
    /**
     * タップ演出（リップル＋遷移中の進捗バー）用の <style> を一度だけ注入する。
     * 押下・遷移中の見た目はクラス（pst-tap と状態クラス）で切り替えるため、
     * インラインstyleとぶつかるプロパティ（transition/transform 等）は付与側で外してある。
     */
    function injectTapStyle() {
        if (document.getElementById(TAP_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = TAP_STYLE_ID;
        style.textContent =
            '.pst-tap{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;overflow:hidden;isolation:isolate;cursor:pointer;transition:filter 150ms ease, background-color 150ms ease;position:relative;}' +
            '.pst-tap > span{position:relative;z-index:1;}' +
            '.pst-tap:focus:not(:focus-visible){outline:none;}' +
            '.pst-tap:focus-visible{outline:2px solid var(--pst-base, #154260);outline-offset:2px;}' +
            '.pst-tap::before{content:"";position:absolute;z-index:0;pointer-events:none;left:var(--pst-rx,50%);top:var(--pst-ry,50%);width:var(--pst-rd,200px);height:var(--pst-rd,200px);margin:calc(var(--pst-rd,200px) / -2) 0 0 calc(var(--pst-rd,200px) / -2);border-radius:50%;background:rgba(255,255,255,.32);transform:scale(0);opacity:0;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 350ms ease;}' +
            '.pst-tap-config::before{background:rgba(21,66,96,.14);}' +
            '.pst-tap.is-pressed::before{transform:scale(1);opacity:1;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 60ms;}' +
            '.pst-tap.is-navigating::before{transform:scale(1);opacity:.55;}' +
            '.pst-tap-link.is-navigating::after{content:"";position:absolute;z-index:1;pointer-events:none;left:0;bottom:0;height:3px;width:40%;background:rgba(255,255,255,.9);border-radius:3px;animation:pst-tap-bar 1s ease-in-out infinite;}' +
            '@keyframes pst-tap-bar{from{transform:translateX(-100%)}to{transform:translateX(250%)}}' +
            '#portal-customize-config .pst-tap-config{background-color:#fff;}' +
            '@media (hover:hover) and (pointer:fine){.pst-tap-link:hover{filter:brightness(1.1);}#portal-customize-config .pst-tap-config:hover:not(.is-pressed){background-color:#f2f5f8;}}' +
            '@media (prefers-reduced-motion: reduce){.pst-tap{transition:none;}.pst-tap::before{display:none;}.pst-tap.is-pressed{filter:brightness(.88);}.pst-tap.is-navigating::after{animation:none;width:100%;opacity:.6;}#portal-customize-config .pst-tap-config.is-pressed{filter:none;background-color:#e6eaee;}}';
        document.head.appendChild(style);
    }

    /**
     * タップ演出（リップル＋遷移中の進捗バー）用の <style> を一度だけ注入する。
     * 押下・遷移中の見た目はクラス（mhb-tap と状態クラス）で切り替えるため、
     * インラインstyleとぶつかるプロパティ（transition/transform 等）は付与側で外してある。
     */
    function injectHomeTapStyle() {
        if (document.getElementById(HOME_TAP_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = HOME_TAP_STYLE_ID;
        style.textContent =
            '.mhb-tap{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;overflow:hidden;isolation:isolate;cursor:pointer;transition:filter 150ms ease, background-color 150ms ease;}' +
            '.mhb-tap:focus:not(:focus-visible){outline:none;}' +
            '.mhb-tap:focus-visible{outline:2px solid #154260;outline-offset:2px;}' +
            '.mhb-tap::before{content:"";position:absolute;z-index:0;pointer-events:none;left:var(--mhb-rx,50%);top:var(--mhb-ry,50%);width:var(--mhb-rd,200px);height:var(--mhb-rd,200px);margin:calc(var(--mhb-rd,200px) / -2) 0 0 calc(var(--mhb-rd,200px) / -2);border-radius:50%;background:rgba(255,255,255,.32);transform:scale(0);opacity:0;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 350ms ease;}' +
            '.mhb-tap.is-pressed::before{transform:scale(1);opacity:1;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 60ms;}' +
            '.mhb-tap.is-navigating::before{transform:scale(1);opacity:.55;}' +
            '.mhb-tap.is-navigating::after{content:"";position:absolute;z-index:1;pointer-events:none;left:30%;bottom:10px;height:3px;width:40%;background:rgba(255,255,255,.9);border-radius:3px;animation:mhb-tap-bar-home 1s ease-in-out infinite;}' +
            '.mhb-tap svg{position:relative;z-index:1;}' +
            '@keyframes mhb-tap-bar-home{0%,100%{transform:scaleX(.3)}50%{transform:scaleX(1)}}' +
            '@media (hover:hover) and (pointer:fine){.mhb-tap:hover{filter:brightness(1.1);}}' +
            '@media (prefers-reduced-motion: reduce){.mhb-tap{transition:none;}.mhb-tap::before{display:none;}.mhb-tap.is-pressed{filter:brightness(.88);}.mhb-tap.is-navigating::after{animation:none;transform:none;}}';
        document.head.appendChild(style);
    }

    /**
     * 通常のクリック（左ボタン・修飾キーなし）かどうか。
     * ctrl/cmd/shift/alt 付きは新規タブ等のブラウザ標準動作なので、遷移中表示にしない。
     */
    function isPlainActivation(e) {
        return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    }

    /**
     * 押下中・遷移中の状態を全要素から外す。
     * 戻る操作（bfcache）やSPA的な画面再表示で、遷移中表示が残ったままになるのを防ぐ。
     */
    function resetTapStates() {
        var els = document.querySelectorAll('.pst-tap.is-pressed, .pst-tap.is-navigating, .mhb-tap.is-pressed, .mhb-tap.is-navigating');
        for (var i = 0; i < els.length; i++) {
            els[i].classList.remove('is-pressed');
            els[i].classList.remove('is-navigating');
        }
    }

    // 戻る操作（bfcache）で復元されたとき、遷移中表示が残らないようにする（登録は1回だけ）
    window.addEventListener('pageshow', resetTapStates);

    /**
     * 要素にタップ演出（リップル＋遷移中の進捗バー）を付ける。
     * @param {HTMLElement} el 対象要素（className に pst-tap / mhb-tap を含めること）
     * @param {boolean} navigates クリックで画面遷移するなら true（遷移中の進捗バーを出す）
     * @param {string} prefix CSS変数の接頭辞。'pst'（ショートカット側）か 'mhb'（ホームボタン側）
     */
    function attachTapFeedback(el, navigates, prefix) {
        var downAt = 0;
        var isDown = false;
        var pressTimer = null;
        var navTimer = null;

        // 一瞬のタップでも波紋が見えるよう、最低 MIN_PRESS_MS は表示を残すための残り時間
        function remaining() {
            return Math.max(0, MIN_PRESS_MS - (Date.now() - downAt));
        }

        // 波紋の中心（要素内座標）と、要素の四隅まで届く直径を CSS 変数で渡す
        function setOrigin(x, y) {
            var rect = el.getBoundingClientRect();
            var w = rect.width;
            var h = rect.height;
            var d = 2 * Math.sqrt(Math.pow(Math.max(x, w - x), 2) + Math.pow(Math.max(y, h - y), 2));
            el.style.setProperty('--' + prefix + '-rx', x + 'px');
            el.style.setProperty('--' + prefix + '-ry', y + 'px');
            el.style.setProperty('--' + prefix + '-rd', d + 'px');
        }

        function setCenter() {
            var rect = el.getBoundingClientRect();
            setOrigin(rect.width / 2, rect.height / 2);
        }

        function clearPress() {
            clearTimeout(pressTimer);
            isDown = false;
            el.classList.remove('is-pressed');
        }

        // キーボード操作など、押下イベントを伴わない場合に中心から短く波紋を出す
        function flashPress() {
            setCenter();
            el.classList.add('is-pressed');
            clearTimeout(pressTimer);
            pressTimer = setTimeout(function () {
                el.classList.remove('is-pressed');
            }, MIN_PRESS_MS);
        }

        el.addEventListener('pointerdown', function (e) {
            if (!e.isPrimary || e.button !== 0) return;
            if (el.classList.contains('is-navigating')) return;
            clearTimeout(pressTimer);
            var rect = el.getBoundingClientRect();
            setOrigin(e.clientX - rect.left, e.clientY - rect.top);
            downAt = Date.now();
            isDown = true;
            el.classList.add('is-pressed');
        });

        el.addEventListener('pointerup', function () {
            if (!isDown) return;
            isDown = false;
            pressTimer = setTimeout(function () {
                el.classList.remove('is-pressed');
            }, remaining());
        });

        el.addEventListener('pointercancel', clearPress);

        // タッチでは pointerup の後にも pointerleave が来るため、押している間だけ取り消しにする
        el.addEventListener('pointerleave', function () {
            if (isDown) clearPress();
        });

        el.addEventListener('click', function (e) {
            if (el.classList.contains('is-navigating')) return;
            if (!navigates || !isPlainActivation(e)) {
                if (!el.classList.contains('is-pressed')) flashPress();
                return;
            }
            if (!el.classList.contains('is-pressed')) setCenter();
            clearTimeout(pressTimer);
            el.classList.remove('is-pressed');
            el.classList.add('is-navigating');
            // 遷移が起きなかった場合に備えたフェイルセーフ
            clearTimeout(navTimer);
            navTimer = setTimeout(function () {
                el.classList.remove('is-navigating');
            }, NAV_FAILSAFE_MS);
        });
    }

    // ============================================================
    // 4. 全体設定（取得・キャッシュ・パース）
    // ============================================================

    /** 全体設定が使えるか。GLOBAL_SETTINGS_APP_ID が数字でない（プレースホルダー）なら false。 */
    function isGlobalAvailable() {
        return (/^[0-9]+$/).test(String(GLOBAL_SETTINGS_APP_ID));
    }

    function isNonNegativeInt(v) {
        return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v;
    }

    /**
     * ボタン配列（v1 / v2）を正規化する。件数が範囲外・要素が不正なら null。
     * 個人設定（parsePersonalPayload）と全体設定（parseGlobalSettingsJson）で共用する。
     */
    function normalizeButtons(buttons, isLegacy) {
        if (!Array.isArray(buttons)) return null;
        if (buttons.length < MIN_SHORTCUTS || buttons.length > MAX_SHORTCUTS) return null;
        var normalized = [];
        for (var i = 0; i < buttons.length; i++) {
            var item = buttons[i];
            if (isLegacy) {
                item = migrateLegacyItem(item);
                if (!item) return null;
            }
            if (!isValidSavedItem(item)) return null;
            var targetName = (typeof item.targetName === 'string') ? item.targetName : '';
            var label = (typeof item.label === 'string' && item.label) ? item.label : (targetName || item.targetId);
            normalized.push({
                type: item.type,
                targetId: String(item.targetId),
                targetName: targetName,
                label: label,
                labelCustom: !!item.labelCustom
            });
        }
        return normalized;
    }

    /**
     * 全体設定の settings_json 文字列をパース・正規化する。使えない内容なら null。
     * セクション単位で不正な場合は、そのセクションだけ（shortcuts は null、design は既定値）に落とす。
     */
    function parseGlobalSettingsJson(raw) {
        if (!raw || typeof raw !== 'string') return null;
        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return null;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        if (parsed.schemaVersion !== GLOBAL_SCHEMA_VERSION) return null;

        var settingsRev = isNonNegativeInt(parsed.settingsRev) ? parsed.settingsRev : 0;

        var design = {
            scTheme: DEFAULT_DESIGN.scTheme,
            scShape: DEFAULT_DESIGN.scShape,
            homeTheme: DEFAULT_DESIGN.homeTheme,
            homeShape: DEFAULT_DESIGN.homeShape
        };
        var pd = (parsed.design && typeof parsed.design === 'object') ? parsed.design : {};
        if (isThemeName(pd.scTheme)) design.scTheme = pd.scTheme;
        if (isShapeName(pd.scShape)) design.scShape = pd.scShape;
        if (isThemeName(pd.homeTheme)) design.homeTheme = pd.homeTheme;
        if (isHomeShapeName(pd.homeShape)) design.homeShape = pd.homeShape;

        function clampForce(v) {
            if (!isNonNegativeInt(v)) return 0;
            return v > settingsRev ? settingsRev : v;
        }

        return {
            schemaVersion: GLOBAL_SCHEMA_VERSION,
            settingsRev: settingsRev,
            shortcuts: normalizeButtons(parsed.shortcuts, false),
            design: design,
            shortcutsForceRev: clampForce(parsed.shortcutsForceRev),
            designForceRev: clampForce(parsed.designForceRev),
            updatedBy: (typeof parsed.updatedBy === 'string') ? parsed.updatedBy : '',
            updatedAt: (typeof parsed.updatedAt === 'string') ? parsed.updatedAt : ''
        };
    }

    /**
     * 保存用の全体設定オブジェクトを作る。
     * @param {Object} draft {shortcuts, design}
     * @param {number} nextRev 新しい settingsRev
     * @param {boolean} forceSc ショートカットを強制反映するか（true なら shortcutsForceRev = nextRev）
     * @param {boolean} forceDs デザインを強制反映するか
     * @param {Object|null} prev 直前の全体設定（強制反映しない側の ForceRev を引き継ぐ）
     */
    function buildGlobalSettingsPayload(draft, nextRev, forceSc, forceDs, prev) {
        var d = draft.design || DEFAULT_DESIGN;
        return {
            schemaVersion: GLOBAL_SCHEMA_VERSION,
            settingsRev: nextRev,
            shortcuts: (draft.shortcuts || []).map(function (item) {
                return {
                    type: item.type || TARGET_TYPE_APP,
                    targetId: item.targetId,
                    targetName: item.targetName || '',
                    label: item.label || item.targetName || item.targetId,
                    labelCustom: !!item.labelCustom
                };
            }),
            design: withDerivedHome(d),
            shortcutsForceRev: forceSc ? nextRev : toRevNumber(prev && prev.shortcutsForceRev),
            designForceRev: forceDs ? nextRev : toRevNumber(prev && prev.designForceRev),
            updatedBy: getUserDisplayName(),
            updatedAt: new Date().toISOString()
        };
    }

    // --- キャッシュ ---
    // 形式: {"appId":"…","recordId":"1"|null,"recordRevision":"5"|null,"fetchedAt":<ms>,"settingsRaw":"<settings_json>"|null}
    function readGlobalCache() {
        var raw = lget(KEY_GLOBAL_CACHE);
        if (!raw) return null;
        try {
            var obj = JSON.parse(raw);
            return (obj && typeof obj === 'object') ? obj : null;
        } catch (e) {
            return null;
        }
    }

    function writeGlobalCache(obj) {
        lset(KEY_GLOBAL_CACHE, JSON.stringify(obj));
    }

    /** キャッシュがまだ新しいか。未来の時刻（時計のずれ）は fresh 扱いにしない。 */
    function isCacheFresh(cache, nowMs, ttlMs, appId) {
        if (!cache || typeof cache !== 'object') return false;
        if (cache.appId !== String(appId)) return false;
        if (typeof cache.fetchedAt !== 'number') return false;
        var age = nowMs - cache.fetchedAt;
        return age >= 0 && age < ttlMs;
    }

    var parsedGlobalMemo = { raw: null, value: null };

    /** 現在有効な全体設定（正規化済み）。使えない・未取得・不正なら null。 */
    function getGlobalSettings() {
        if (!isGlobalAvailable()) return null;
        var cache = readGlobalCache();
        if (!cache || cache.appId !== String(GLOBAL_SETTINGS_APP_ID) || typeof cache.settingsRaw !== 'string') return null;
        if (parsedGlobalMemo.raw !== cache.settingsRaw) {
            parsedGlobalMemo.raw = cache.settingsRaw;
            parsedGlobalMemo.value = parseGlobalSettingsJson(cache.settingsRaw);
        }
        return parsedGlobalMemo.value;
    }

    function getCurrentSettingsRev() {
        var gs = getGlobalSettings();
        return gs ? gs.settingsRev : 0;
    }

    var pendingRefresh = null; // 実行中の取得があれば { changed: 内容が変わったとき, settled: 取得が成功したとき } のコールバック配列

    /**
     * 全体設定アプリから最新を取得してキャッシュする（キャッシュが新しければ何もしない）。
     * 内容が変わったときだけ onChanged を呼ぶ。onSettled は取得に成功したときに（変化の有無によらず）呼ぶ。
     * 失敗時は console.warn のみでキャッシュは変えない。
     */
    function refreshGlobalSettings(force, onChanged, onSettled) {
        if (!isGlobalAvailable()) return;
        if (pendingRefresh) {
            if (onChanged) pendingRefresh.changed.push(onChanged);
            if (onSettled) pendingRefresh.settled.push(onSettled);
            return;
        }
        var cache = readGlobalCache();
        if (!force && isCacheFresh(cache, Date.now(), GLOBAL_CACHE_TTL_MS, GLOBAL_SETTINGS_APP_ID)) return;

        var callbacks = onChanged ? [onChanged] : [];
        var settledCallbacks = onSettled ? [onSettled] : [];
        pendingRefresh = { changed: callbacks, settled: settledCallbacks };
        var prevRaw = (cache && typeof cache.settingsRaw === 'string') ? cache.settingsRaw : null;

        kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET',
            { app: GLOBAL_SETTINGS_APP_ID, query: 'order by $id asc limit 1', fields: ['$id', '$revision', FIELD_GLOBAL_SETTINGS] },
            function (resp) {
                pendingRefresh = null;
                var records = (resp && resp.records) ? resp.records : [];
                var rec = records.length ? records[0] : null;
                var raw = null;
                if (rec && rec[FIELD_GLOBAL_SETTINGS] && typeof rec[FIELD_GLOBAL_SETTINGS].value === 'string' && rec[FIELD_GLOBAL_SETTINGS].value) {
                    raw = rec[FIELD_GLOBAL_SETTINGS].value;
                }
                writeGlobalCache({
                    appId: String(GLOBAL_SETTINGS_APP_ID),
                    recordId: rec && rec.$id ? String(rec.$id.value) : null,
                    recordRevision: rec && rec.$revision ? String(rec.$revision.value) : null,
                    fetchedAt: Date.now(),
                    settingsRaw: raw
                });
                if (raw !== prevRaw) {
                    for (var i = 0; i < callbacks.length; i++) {
                        try { callbacks[i](); } catch (e) { console.error('portal-navigation: 再描画に失敗しました。', e); }
                    }
                }
                for (var j = 0; j < settledCallbacks.length; j++) {
                    try { settledCallbacks[j](); } catch (e2) { console.error('portal-navigation: 取得後の処理に失敗しました。', e2); }
                }
            },
            function (err) {
                pendingRefresh = null;
                console.warn('portal-navigation: 全体設定の取得に失敗しました。', err);
            }
        );
    }


    // ============================================================
    // 5. 優先順位の解決（個人設定 → 全体設定 → JS内の最終既定値）と強制反映
    // ============================================================

    /**
     * 個人設定が有効か。個人設定の baseRev が ForceRev 以上なら有効（数値でなければ 0 として扱う）。
     */
    function isPersonalValid(baseRev, forceRev) {
        return toRevNumber(baseRev) >= toRevNumber(forceRev);
    }

    /**
     * 表示するショートカット一覧を決める（純関数）。
     * @returns {{list:Array, source:'personal'|'global'|'default', forced:boolean}}
     *   forced は「個人設定があったのに強制反映で無効になり、全体設定が使われた」場合に true。
     */
    function resolveShortcutList(personal, globalSettings, defaults) {
        var forceRev = globalSettings ? globalSettings.shortcutsForceRev : 0;
        if (personal && personal.buttons && isPersonalValid(personal.baseRev, forceRev)) {
            return { list: personal.buttons, source: 'personal', forced: false };
        }
        if (globalSettings && globalSettings.shortcuts) {
            return { list: globalSettings.shortcuts, source: 'global', forced: !!personal };
        }
        return { list: defaults, source: 'default', forced: false };
    }

    /** 個人のデザイン設定（🎨 の色・形）を localStorage から読む。値が無い・範囲外のキーは null。 */
    function readPersonalDesign() {
        function readIdx(key, len) {
            var p = parseInt(lget(key), 10);
            return (!isNaN(p) && p >= 0 && p < len) ? p : null;
        }
        var rev = parseInt(lget(KEY_DESIGN_REV), 10);
        return {
            scThemeIdx: readIdx(KEY_THEME_IDX, THEMES.length),
            scShapeIdx: readIdx(KEY_SHAPE_IDX, SHAPES.length),
            rev: (isNaN(rev) || rev < 0) ? 0 : rev
        };
    }

    /**
     * 表示する色・形を決める（純関数）。名前で返す。
     * 土台は全体設定（無ければ DEFAULT_DESIGN）。個人設定が有効ならキー単位で上書きする。
     * ホームボタンの色・形は scTheme/scShape から派生する（全体設定の homeTheme/homeShape は使わない）。
     * forced は「個人設定に値があったのに強制反映で無効になった」場合に true。
     */
    function resolveDesign(personalDesign, globalSettings) {
        var base = (globalSettings && globalSettings.design) ? globalSettings.design : DEFAULT_DESIGN;
        var out = { scTheme: base.scTheme, scShape: base.scShape, forced: false };
        function finish(o) {
            o.homeTheme = o.scTheme;
            o.homeShape = homeShapeNameForScShape(o.scShape);
            return o;
        }
        var pd = personalDesign;
        if (!pd) return finish(out);
        var has = (pd.scThemeIdx != null) || (pd.scShapeIdx != null);
        if (!has) return finish(out);
        var forceRev = globalSettings ? globalSettings.designForceRev : 0;
        if (!isPersonalValid(pd.rev, forceRev)) {
            out.forced = true;
            return finish(out);
        }
        if (typeof pd.scThemeIdx === 'number' && THEMES[pd.scThemeIdx]) out.scTheme = THEMES[pd.scThemeIdx].name;
        if (typeof pd.scShapeIdx === 'number' && SHAPES[pd.scShapeIdx]) out.scShape = SHAPES[pd.scShapeIdx].name;
        return finish(out);
    }

    /** 今の有効なデザイン（ストレージと全体設定から決める）。 */
    function currentDesign() {
        return resolveDesign(readPersonalDesign(), getGlobalSettings());
    }

    /** 設定モーダルのテーマ連動用。現在のテーマ（色）を返す。 */
    function getCurrentTheme() {
        return THEMES[themeIndexByName(currentDesign().scTheme)];
    }

    /** 設定モーダルのプレビュー用。現在の形状（角丸）を返す。 */
    function getCurrentShape() {
        return SHAPES[shapeIndexByName(currentDesign().scShape)];
    }

    /**
     * 個人のデザイン設定（色・形）をまとめて保存する。
     * 2つとも上書きし、旧キー（ホームボタンの色）を掃除して、その時点の settingsRev を
     * kintone_portal_design_rev に1回だけ記録する。不正な名前なら何も書かず false。
     */
    function savePersonalDesign(themeName, shapeName) {
        if (!isThemeName(themeName) || !isShapeName(shapeName)) return false;
        lset(KEY_THEME_IDX, String(themeIndexByName(themeName)));
        lset(KEY_SHAPE_IDX, String(shapeIndexByName(shapeName)));
        lremove(KEY_HOME_THEME_IDX);
        lset(KEY_DESIGN_REV, String(getCurrentSettingsRev()));
        return true;
    }

    /** 個人のデザイン設定（色・形・旧ホーム色・記録した rev）をすべて消す。管理者の既定に戻る。 */
    function clearPersonalDesign() {
        lremove(KEY_THEME_IDX);
        lremove(KEY_SHAPE_IDX);
        lremove(KEY_HOME_THEME_IDX);
        lremove(KEY_DESIGN_REV);
    }


    // ============================================================
    // 6. 共有コーディネーター: window.PortalCustomize
    // ============================================================
    // 冪等定義: 既に他ファイルが定義していればそれを再利用する。
    var PortalCustomize = window.PortalCustomize = window.PortalCustomize || {
        _container: null,
        _config: null,

        /**
         * ポータルのコンテナとconfigスロットを1度だけ生成する。
         * @param {boolean} isMobile
         * @param {HTMLElement} portalSpace 挿入先（getContentSpaceElement の戻り値）
         * @returns {HTMLElement|null} メインコンテナ（取得失敗時 null）
         */
        init: function (isMobile, portalSpace) {
            // 既に生成済み（自身が保持 or DOM上に存在）なら再利用
            if (this._container && document.body.contains(this._container)) {
                return this._container;
            }
            var existing = document.getElementById(CONTAINER_ID);
            if (existing) {
                this._container = existing;
                this._config = document.getElementById(CONFIG_ID);
                return existing;
            }
            if (!portalSpace) return null;

            // --- メインコンテナ生成 ---
            var container = document.createElement('div');
            container.id = CONTAINER_ID;
            container.style.display = 'flex';
            container.style.flexWrap = 'wrap';
            container.style.width = '100%';
            container.style.boxSizing = 'border-box';
            container.style.alignItems = 'center';
            if (isMobile) {
                container.style.justifyContent = 'space-between';
                container.style.gap = '10px';
                container.style.padding = '15px 10px';
            } else {
                container.style.justifyContent = 'flex-start';
                container.style.gap = '15px';
                container.style.padding = '20px 0 30px 0';
            }

            // --- configContainer（色/形/個人設定 ＋ フォント の器） ---
            var config = document.createElement('div');
            config.id = CONFIG_ID;
            config.style.display = 'flex';
            config.style.gap = '8px';
            config.style.alignItems = 'center';
            if (!isMobile) {
                config.style.marginLeft = '10px';
                config.style.flexGrow = '1';
            } else {
                config.style.width = '100%';
                config.style.marginTop = '10px';
            }

            // configContainer は常にコンテナの末尾に置く（ショートカットは insertBefore で前に入る）
            container.appendChild(config);
            portalSpace.appendChild(container);

            this._container = container;
            this._config = config;
            return container;
        },

        getContainer: function () { return this._container; },
        getConfigContainer: function () { return this._config; },

        /** スロット1: ショートカット項目を configContainer より前に挿入 */
        addShortcutItem: function (el) {
            if (!this._container) return;
            this._container.insertBefore(el, this._config);
        },

        /** スロット2/3: configContainer へ項目を追加 */
        addConfigItem: function (el) {
            if (!this._config) return;
            this._config.appendChild(el);
        }
    };

    // ============================================================
    // 7. ショートカット部（個人カスタマイズ・端末間同期・設定モーダル）
    // ============================================================
    function getStorageKey() {
        try {
            var user = kintone.getLoginUser();
            if (user && user.id) {
                return STORAGE_KEY_PREFIX + '_' + user.id;
            }
        } catch (e) {
            // フォールバックへ
        }
        return STORAGE_KEY_FALLBACK;
    }

    function defaultShortcutList() {
        // appList（管理者既定値）を保存データと同じ形（v2）へ変換する
        return appList.map(function (app) {
            return { type: TARGET_TYPE_APP, targetId: String(app.id), targetName: app.name, label: app.name, labelCustom: false };
        });
    }

    function isValidSavedItem(item) {
        return !!item && typeof item === 'object' &&
            (item.type === TARGET_TYPE_APP || item.type === TARGET_TYPE_SPACE) &&
            typeof item.targetId === 'string' && item.targetId.length > 0;
    }

    /**
     * v1形式（{appId, appName, label, labelCustom}）の要素を v2形式へ変換する。
     * appId が文字列でない/空の場合は全体を無効化するため null を返す。
     */
    function migrateLegacyItem(item) {
        if (!item || typeof item !== 'object') return null;
        var appId = item.appId;
        if (typeof appId !== 'string' || !appId.length) return null;
        var appName = (typeof item.appName === 'string') ? item.appName : '';
        var label = (typeof item.label === 'string' && item.label) ? item.label : (appName || appId);
        return {
            type: TARGET_TYPE_APP,
            targetId: appId,
            targetName: appName,
            label: label,
            labelCustom: !!item.labelCustom
        };
    }

    /**
     * 個人設定のJSON文字列をパース・バリデーションする。以下はすべて null（無効）とする:
     * 値なし / JSONパース失敗 / 配列でない / 要素数が範囲外 / 要素が不正 / スキーマ不明。
     * 戻り値は {buttons, baseRev}。baseRev は「保存した時点の全体設定の改訂番号（settingsRev）」で、
     * 無ければ（旧データなら）0。v1（SETTINGS_SCHEMA_VERSION_LEGACY）データは v2 形へ自動移行する（baseRev は 0）。
     * localStorage から読む場合・リモート（個人設定アプリ）から読む場合の両方で共用する。
     */
    function parsePersonalPayload(raw) {
        if (!raw) return null;

        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return null;
        }
        if (!parsed || typeof parsed !== 'object') return null;
        var ver = parsed.version;
        if (ver !== SETTINGS_SCHEMA_VERSION && ver !== SETTINGS_SCHEMA_VERSION_LEGACY) return null;

        var isLegacy = (ver === SETTINGS_SCHEMA_VERSION_LEGACY);
        var buttons = normalizeButtons(parsed.buttons, isLegacy);
        if (!buttons) return null;
        return { buttons: buttons, baseRev: (!isLegacy && isNonNegativeInt(parsed.baseRev)) ? parsed.baseRev : 0 };
    }

    /** 設定JSON文字列からボタン配列だけを取り出す（互換のための薄いラッパー）。無効なら null。 */
    function parseSettingsJson(raw) {
        var personal = parsePersonalPayload(raw);
        return personal ? personal.buttons : null;
    }

    /** 保存済みの個人設定（localStorageキャッシュ）を読む。無効・未保存なら null。 */
    function readPersonalSettings() {
        return parsePersonalPayload(lget(getStorageKey()));
    }

    /** 優先順位（個人設定 → 全体設定 → JS既定）を解決した結果 {list, source, forced}。 */
    function loadShortcutResolution() {
        return resolveShortcutList(readPersonalSettings(), getGlobalSettings(), defaultShortcutList());
    }

    /**
     * 表示するショートカット一覧を返す（個人設定 → 全体設定 → JS既定 の優先順位）。
     */
    function loadShortcutSettings() {
        return loadShortcutResolution().list;
    }

    /** 件数(4〜6)・アプリID必須 のバリデーション（保存直前に再実施する）。 */
    function validateShortcutList(list) {
        if (!Array.isArray(list) || list.length < MIN_SHORTCUTS || list.length > MAX_SHORTCUTS) {
            throw new Error('ショートカットは' + MIN_SHORTCUTS + '〜' + MAX_SHORTCUTS + '個にしてください。');
        }
        for (var i = 0; i < list.length; i++) {
            if (!isValidSavedItem(list[i])) {
                throw new Error('遷移先（アプリ／スペース）が選択されていない行があります。');
            }
        }
    }

    /**
     * localStorage 保存 / リモート保存の両方で使う、共通スキーマ（v2）のペイロードを組み立てる。
     * baseRev は保存時点の全体設定の改訂番号（settingsRev）。無ければ 0。
     */
    function buildSettingsPayload(list, baseRev) {
        return {
            version: SETTINGS_SCHEMA_VERSION,
            buttons: list.map(function (item) {
                return {
                    type: item.type || TARGET_TYPE_APP,
                    targetId: item.targetId,
                    targetName: item.targetName || '',
                    label: item.label || item.targetName || item.targetId,
                    labelCustom: !!item.labelCustom
                };
            }),
            baseRev: baseRev || 0
        };
    }

    /** 保存する。件数(4〜6)・アプリID必須 のバリデーションを再度実施する。 */
    function saveShortcutSettings(list) {
        validateShortcutList(list);
        var payload = buildSettingsPayload(list, getCurrentSettingsRev());
        try {
            localStorage.setItem(getStorageKey(), JSON.stringify(payload));
        } catch (e) {
            throw new Error('設定の保存に失敗しました（ブラウザのプライベートモードや保存容量の上限が原因の可能性があります）。');
        }
    }

    function resetShortcutSettings() {
        try {
            localStorage.removeItem(getStorageKey());
        } catch (e) {
            // 削除失敗は致命的ではないため無視する
        }
    }

    // ============================================================
    // 端末間同期（設定アプリ方式）: 保存先モード・同期可否・リモートAPI
    // ============================================================

    /** 保存先モード（'app'=共有 / 'local'=この端末だけ）を保存する localStorage キー（端末・ユーザー単位）。 */
    function getStorageModeKey() {
        try {
            var user = kintone.getLoginUser();
            if (user && user.id) {
                return STORAGE_MODE_KEY_PREFIX + '_' + user.id;
            }
        } catch (e) {
            // フォールバックへ
        }
        return STORAGE_MODE_KEY_PREFIX + '_default';
    }

    /**
     * 端末間同期機能が有効かどうか。SETTINGS_APP_ID が数値として解釈できる文字列でない
     * （＝プレースホルダーのまま）場合は false を返す。false の場合、呼び出し側は
     * リモートAPIを一切呼ばず、保存先モードは常に 'local' として扱うこと。
     */
    function isSyncAvailable() {
        return (/^[0-9]+$/).test(String(SETTINGS_APP_ID));
    }

    /** 現在の保存先モードを取得する。同期無効時は常に 'local'。既定値は 'app'（共有）。 */
    function getStorageMode() {
        if (!isSyncAvailable()) return SYNC_MODE_LOCAL;
        try {
            var mode = localStorage.getItem(getStorageModeKey());
            if (mode === SYNC_MODE_APP || mode === SYNC_MODE_LOCAL) return mode;
        } catch (e) {
            // 既定へ
        }
        return SYNC_MODE_APP;
    }

    function setStorageMode(mode) {
        try {
            localStorage.setItem(getStorageModeKey(), mode);
        } catch (e) {
            // 保存できなくても致命的ではないため無視する
        }
    }

    /** 設定アプリから、自分（ログイン名一致）のレコードを1件取得する。なければ null を返す。 */
    function fetchRemoteRecord(onSuccess, onError) {
        var loginName = getLoginName();
        if (!loginName) {
            onError(new Error('ログインユーザー情報を取得できません。'));
            return;
        }
        var query = FIELD_LOGIN_NAME + ' = "' + loginName.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '" limit 1';
        kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET',
            { app: SETTINGS_APP_ID, query: query },
            function (resp) {
                var records = (resp && resp.records) ? resp.records : [];
                onSuccess(records.length ? records[0] : null);
            },
            function (err) {
                onError(err);
            }
        );
    }

    /** 設定を設定アプリへ保存する。既存レコードがあれば更新（PUT）、なければ新規作成（POST）。 */
    function saveRemote(list, onSuccess, onError) {
        var loginName = getLoginName();
        if (!loginName) {
            onError(new Error('ログインユーザー情報を取得できません。'));
            return;
        }
        var jsonStr = JSON.stringify(buildSettingsPayload(list, getCurrentSettingsRev()));

        fetchRemoteRecord(function (record) {
            if (record) {
                var updateRecord = {};
                updateRecord[FIELD_SETTINGS_JSON] = { value: jsonStr };
                kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT',
                    { app: SETTINGS_APP_ID, id: record.$id.value, record: updateRecord },
                    function (resp) { onSuccess(resp); },
                    function (err) { onError(err); }
                );
            } else {
                var newRecord = {};
                newRecord[FIELD_LOGIN_NAME] = { value: loginName };
                newRecord[FIELD_SETTINGS_JSON] = { value: jsonStr };
                kintone.api(kintone.api.url('/k/v1/record.json', true), 'POST',
                    { app: SETTINGS_APP_ID, record: newRecord },
                    function (resp) { onSuccess(resp); },
                    function (err) { onError(err); }
                );
            }
        }, function (err) {
            onError(err);
        });
    }

    /** 設定アプリの自分のレコードを削除する（既定に戻す・共有モード時）。レコードがなければ何もしない。 */
    function deleteRemote(onSuccess, onError) {
        fetchRemoteRecord(function (record) {
            if (!record) {
                onSuccess();
                return;
            }
            kintone.api(kintone.api.url('/k/v1/records.json', true), 'DELETE',
                { app: SETTINGS_APP_ID, ids: [record.$id.value] },
                function (resp) { onSuccess(resp); },
                function (err) { onError(err); }
            );
        }, function (err) {
            onError(err);
        });
    }

    /**
     * ポータル描画直後に、非同期でリモート設定と同期する（保存先モードが 'app' かつ同期有効な場合のみ）。
     * 取得失敗・レコードなし・バリデーション不合格の場合は何もしない（キャッシュ表示を維持し、
     * console.error のみ行う。ユーザーへのエラー表示はしない）。内容がキャッシュと異なる場合のみ
     * localStorage を上書きし、onChanged（再描画コールバック）を呼ぶ。
     */
    function syncFromRemote(onChanged) {
        if (!isSyncAvailable() || getStorageMode() !== SYNC_MODE_APP) return;

        fetchRemoteRecord(function (record) {
            if (!record) return;
            var field = record[FIELD_SETTINGS_JSON];
            var remoteRaw = field ? field.value : null;
            var personal = parsePersonalPayload(remoteRaw);
            if (!personal) return;

            // 個人設定アプリ側の baseRev もそのままローカルのキャッシュへ保存する（比較用の文字列も baseRev 込み）
            var payloadStr = JSON.stringify(buildSettingsPayload(personal.buttons, personal.baseRev));
            var currentRaw;
            try {
                currentRaw = localStorage.getItem(getStorageKey());
            } catch (e) {
                currentRaw = null;
            }
            if (currentRaw === payloadStr) return; // キャッシュと同一内容のため何もしない

            try {
                localStorage.setItem(getStorageKey(), payloadStr);
            } catch (e) {
                return; // キャッシュ更新に失敗した場合は何もしない
            }
            if (onChanged) onChanged();
        }, function (err) {
            console.error('portal-navigation: リモート設定の取得に失敗しました。', err);
        });
    }
    // ============================================================
    // 個人カスタマイズ: アプリ一覧取得（⚙️ モーダルを開いた時のみ実行）
    // ============================================================
    var appListCache = null; // セッション内キャッシュ（モーダル再オープン時の再取得を避ける）

    function fetchAllApps(onSuccess, onError) {
        if (appListCache) {
            onSuccess(appListCache);
            return;
        }
        var results = [];
        var limit = 100;
        var offset = 0;
        var maxLoops = 10; // 暴走防止（100件 x 10回 = 1000件まで）
        var loopCount = 0;

        function fetchPage() {
            loopCount++;
            kintone.api(kintone.api.url('/k/v1/apps.json', true), 'GET', { limit: limit, offset: offset })
                .then(function (resp) {
                    var apps = (resp && resp.apps) ? resp.apps : [];
                    for (var i = 0; i < apps.length; i++) {
                        results.push({
                            id: String(apps[i].appId),
                            name: apps[i].name,
                            spaceId: (apps[i].spaceId != null ? String(apps[i].spaceId) : null)
                        });
                    }
                    if (apps.length === limit && loopCount < maxLoops) {
                        offset += limit;
                        fetchPage();
                    } else {
                        // アプリ名順（日本語ロケール）に一度だけソートしてキャッシュする。
                        // 以降は毎行ソートせず、このソート済み配列を使い回す。
                        results.sort(function (a, b) {
                            return a.name.localeCompare(b.name, 'ja');
                        });
                        appListCache = results;
                        onSuccess(results);
                    }
                })
                .catch(function (err) {
                    onError(err);
                });
        }
        fetchPage();
    }

    // ============================================================
    // 個人カスタマイズ: スペース候補取得（B: apps.jsonのspaceId由来 ／ C: URL/ID貼り付け）
    // ============================================================
    var spaceListCache = null; // セッション内キャッシュ（モーダル再オープン時の再取得を避ける）
    var spaceNameCache = {};   // spaceId -> name（fetchSpaceById 成功時に随時更新）

    /**
     * スペースIDを指定して1件取得する（C: URL/ID貼り付け経路、および fetchAllSpaces から共用）。
     * 成功時は {id, name} を渡す。失敗（403/404含む）は console.error のみで onFail を呼ぶ。
     */
    function fetchSpaceById(spaceId, onSuccess, onFail) {
        kintone.api(kintone.api.url('/k/v1/space.json', true), 'GET', { id: spaceId })
            .then(function (resp) {
                var space = { id: String(spaceId), name: (resp && resp.name) ? resp.name : String(spaceId) };
                spaceNameCache[space.id] = space.name;
                onSuccess(space);
            })
            .catch(function (err) {
                console.error('portal-navigation: スペース情報の取得に失敗しました。', spaceId, err);
                if (onFail) onFail(err);
            });
    }

    /**
     * apps.json の spaceId をユニーク化し、各IDについて1回ずつ /k/v1/space.json を呼んで
     * スペース候補一覧を作る（B: 主軸）。403/404 等の失敗は静かに除外する。
     * appListCache が null、または spaceId を持つアプリが1つもない場合は空配列で onDone を呼ぶ。
     * エラーコールバックは持たない（このAPI自体はユーザーへエラー表示しない）。
     */
    function fetchAllSpaces(onDone) {
        if (spaceListCache) {
            onDone(spaceListCache);
            return;
        }
        if (!appListCache || !appListCache.length) {
            onDone([]);
            return;
        }

        var seen = {};
        var ids = [];
        for (var i = 0; i < appListCache.length; i++) {
            var sid = appListCache[i].spaceId;
            if (sid && !seen[sid]) {
                seen[sid] = true;
                ids.push(sid);
            }
        }
        if (!ids.length) {
            onDone([]);
            return;
        }
        if (ids.length > SPACE_FETCH_MAX) {
            console.warn('portal-navigation: スペース候補数が上限を超えたため切り詰めます。', ids.length, '>', SPACE_FETCH_MAX);
            ids = ids.slice(0, SPACE_FETCH_MAX);
        }

        var results = [];
        var nextIndex = 0;
        var remaining = ids.length;
        var workerCount = Math.min(SPACE_FETCH_CONCURRENCY, ids.length);

        function finishOne() {
            remaining--;
            if (remaining <= 0) {
                results.sort(function (a, b) {
                    return a.name.localeCompare(b.name, 'ja');
                });
                spaceListCache = results;
                onDone(results);
            }
        }

        function worker() {
            if (nextIndex >= ids.length) return;
            var id = ids[nextIndex++];
            fetchSpaceById(id, function (space) {
                results.push(space);
                finishOne();
                worker();
            }, function () {
                // 失敗は静かに除外する
                finishOne();
                worker();
            });
        }

        for (var w = 0; w < workerCount; w++) {
            worker();
        }
    }

    /**
     * スペースURL または スペースID の入力文字列からスペースIDを抽出する。
     * 数字のみならそれをそのまま、URLなら SPACE_ID_PATTERN でマッチした部分を返す。
     * どちらでもなければ null。
     */
    function extractSpaceIdFromInput(raw) {
        if (typeof raw !== 'string') return null;
        var trimmed = raw.trim();
        if (!trimmed) return null;
        if (/^[0-9]+$/.test(trimmed)) return trimmed;
        var matched = trimmed.match(SPACE_ID_PATTERN);
        if (matched) return matched[1];
        return null;
    }

    /**
     * スペース候補の配列 spaces（{id, name}）に space を追加する純関数。
     * 同じ id が既にあれば何も変えず false。無ければ追加して名前順（日本語）に並べ替え true。
     */
    function addSpaceCandidate(spaces, space) {
        for (var i = 0; i < spaces.length; i++) {
            if (String(spaces[i].id) === String(space.id)) return false;
        }
        spaces.push(space);
        spaces.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ja'); });
        return true;
    }
    // ============================================================
    // 個人カスタマイズ: 設定モーダルの <style> 注入
    // ============================================================
    function injectModalStyle() {
        if (document.getElementById(MODAL_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = MODAL_STYLE_ID;
        style.textContent =
            '.psm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(17,24,32,0.45);' +
            '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);' +
            'z-index:100000;display:flex;align-items:center;justify-content:center;' +
            'opacity:0;transition:opacity 150ms ease;}' +
            '.psm-overlay.psm-visible{opacity:1;}' +
            '.psm-dialog{background:#fff;border-radius:14px;width:560px;max-width:92vw;max-height:86vh;' +
            'display:flex;flex-direction:column;overflow:hidden;' +
            'box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 48px rgba(0,0,0,.16);' +
            'transform:scale(.97) translateY(10px);transition:transform 200ms cubic-bezier(.2,.8,.3,1);}' +
            '.psm-overlay.psm-visible .psm-dialog{transform:scale(1) translateY(0);}' +
            '.psm-header{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;' +
            'background-image:linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.12)),var(--psm-grad,linear-gradient(#154260,#154260));}' +
            '.psm-title{font-size:16px;font-weight:500;margin:0;color:#fff;}' +
            '.psm-close{width:26px;height:26px;padding:0;border:none;border-radius:50%;cursor:pointer;' +
            'background:rgba(255,255,255,.18);color:#fff;font-size:16px;line-height:1;' +
            'display:flex;align-items:center;justify-content:center;transition:background .15s;}' +
            '.psm-close:hover{background:rgba(255,255,255,.3);}' +
            '.psm-body{padding:16px 22px;overflow-y:auto;flex:1;background:#f6f8fa;}' +
            '.psm-intro{font-size:13px;color:#6b7684;margin:0 0 14px 0;}' +
            '.psm-preview-box{background:#fff;border:1px solid #e6eaef;border-radius:10px;padding:12px;' +
            'margin-bottom:14px;display:flex;flex-wrap:wrap;gap:6px;max-height:96px;overflow-y:auto;}' +
            '.psm-preview-btn{padding:8px 10px;font-size:11px;font-weight:bold;color:#fff;' +
            'text-align:center;line-height:1.3;box-sizing:border-box;}' +
            '.psm-preview-empty{padding:7px 10px;font-size:11px;color:#8b95a1;' +
            'border:1px dashed #c8d0d8;border-radius:8px;background:#fff;}' +
            '.psm-row{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px;' +
            'padding:14px;border:1px solid #e6eaef;border-radius:10px;background:#fff;flex-wrap:wrap;}' +
            '.psm-row-badge{flex:0 0 auto;width:24px;height:24px;border-radius:50%;' +
            'background:var(--psm-tint,#dbe9f5);color:var(--psm-base,#154260);font-size:11px;font-weight:500;' +
            'display:flex;align-items:center;justify-content:center;margin-top:2px;}' +
            '.psm-row-main{flex:1;min-width:220px;display:flex;flex-direction:column;gap:10px;}' +
            '.psm-field{display:flex;flex-direction:column;}' +
            '.psm-field-label{font-size:11px;font-weight:500;color:#6b7684;letter-spacing:.04em;margin:0 0 5px 0;}' +
            '.psm-input,.psm-select{padding:10px 12px;border:1px solid #d8dee4;border-radius:8px;font-size:13px;' +
            'width:100%;box-sizing:border-box;background:#fff;color:#1a2027;transition:border-color .15s,box-shadow .15s;}' +
            '.psm-input:focus,.psm-select:focus{outline:none;border-color:var(--psm-base,#154260);' +
            'box-shadow:0 0 0 3px var(--psm-tint,#dbe9f5);}' +
            '.psm-row-actions{display:flex;gap:6px;align-items:center;}' +
            '.psm-icon-btn{width:32px;height:32px;padding:0;border:1px solid #e0e5ea;background:#fff;' +
            'border-radius:8px;cursor:pointer;font-size:12px;color:#6b7684;' +
            'display:flex;align-items:center;justify-content:center;transition:background .15s;}' +
            '.psm-icon-btn:hover:not(:disabled){background:#f2f5f8;}' +
            '.psm-icon-btn:disabled{opacity:0.35;cursor:not-allowed;}' +
            '.psm-warn{color:#c0392b;font-size:12px;margin-top:2px;}' +
            '.psm-space-add{margin-top:12px;padding-top:12px;border-top:1px dashed #e0e5ea;}' +
            '.psm-space-add-row{display:flex;gap:8px;align-items:center;}' +
            '.psm-space-add-note{font-size:12px;color:#6b7684;margin:6px 0 0 0;}' +
            '.psm-space-add-msg{font-size:12px;margin:6px 0 0 0;}' +
            '.psm-sync-section{margin-top:14px;padding-top:14px;border-top:1px solid #e6eaef;}' +
            '.psm-sync-heading{font-size:11px;font-weight:500;color:#6b7684;letter-spacing:.04em;margin:0 0 8px 0;}' +
            '.psm-seg{display:flex;background:#eaeef2;border-radius:9px;padding:3px;gap:3px;}' +
            '.psm-seg-option{flex:1;position:relative;display:flex;align-items:center;justify-content:center;' +
            'text-align:center;padding:8px 6px;border-radius:7px;font-size:12px;color:#5f6b76;' +
            'cursor:pointer;transition:background .15s,color .15s;}' +
            '.psm-seg-option input{position:absolute;opacity:0;width:1px;height:1px;margin:0;}' +
            '.psm-seg-option.psm-seg-active{background:var(--psm-base,#154260);color:#fff;}' +
            '.psm-seg-option input:focus-visible + span{outline:2px solid var(--psm-base,#154260);outline-offset:3px;}' +
            '.psm-sync-note{font-size:12px;color:#6b7684;margin:8px 0 0 0;}' +
            '.psm-footer{display:flex;justify-content:space-between;align-items:center;' +
            'padding:14px 22px;border-top:1px solid #e6eaef;gap:8px;flex-wrap:wrap;background:#fff;}' +
            '.psm-footer-left,.psm-footer-right{display:flex;gap:8px;}' +
            '.psm-btn{padding:9px 14px;border-radius:8px;font-size:13px;cursor:pointer;' +
            'border:1px solid #dde2e8;background:#fff;color:#3d4650;transition:background .15s;}' +
            '.psm-btn:hover:not(:disabled){background:#f2f5f8;}' +
            '.psm-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
            '.psm-btn-primary{padding:9px 18px;border:none;background-image:var(--psm-grad,linear-gradient(#154260,#154260));color:#fff;}' +
            '.psm-btn-primary:hover:not(:disabled){filter:brightness(1.08);background-image:var(--psm-grad,linear-gradient(#154260,#154260));}' +
            '.psm-error{color:#c0392b;font-size:13px;margin:0 0 10px 0;}' +
            '.psm-loading{padding:40px 0;text-align:center;color:#8b95a1;font-size:13px;}' +
            '@media (max-width:600px){' +
            '.psm-overlay{align-items:stretch;justify-content:stretch;}' +
            '.psm-dialog{width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0;' +
            'transform:translateY(14px);}' +
            '.psm-overlay.psm-visible .psm-dialog{transform:translateY(0);}' +
            '.psm-input,.psm-select{font-size:16px;}' +
            '.psm-seg{flex-direction:column;}' +
            '.psm-space-add-row{flex-direction:column;align-items:stretch;}' +
            '}';
        document.head.appendChild(style);
    }

    // ============================================================
    // デザイン部品（スウォッチ・セグメント・プレビュー）。🎨 のモーダルと管理者のデザインタブで共用する
    // ============================================================
    function injectDesignPartsStyle() {
        if (document.getElementById(DESIGN_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = DESIGN_STYLE_ID;
        style.textContent =
            '.pna-card{background:#fff;border:1px solid #e6eaef;border-radius:10px;padding:14px;margin-bottom:12px;}' +
            '.pna-card h3{font-size:13px;margin:0 0 10px 0;}' +
            '.pna-card .psm-preview-box{background:none;border:none;padding:0;margin-bottom:0;max-height:none;align-content:flex-start;align-items:flex-start;}' +
            '.pna-hint{font-size:12px;color:#8b95a1;margin-top:4px;}' +
            '.pna-swatches{display:flex;flex-wrap:wrap;gap:10px;}' +
            '.pna-swatch{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#5b6672;background:none;border:none;padding:0;}' +
            '.pna-chip{width:52px;height:32px;border-radius:8px;border:3px solid transparent;box-shadow:0 0 0 1px #dde2e8;}' +
            '.pna-swatch.sel .pna-chip{border-color:#fff;box-shadow:0 0 0 2px #2c3440;}' +
            '.pna-swatch.sel{color:#1a2027;font-weight:600;}' +
            '.pna-seg{display:inline-flex;background:#eaeef2;border-radius:9px;padding:3px;gap:3px;}' +
            '.pna-seg button{border:none;background:none;padding:7px 14px;border-radius:7px;font-size:12px;color:#5f6b76;cursor:pointer;}' +
            '.pna-seg button.on{background:#2c3440;color:#fff;}' +
            '.pna-design-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}' +
            '.pna-preview-grid{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;}' +
            '.pna-design-cell{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;}' +
            '.pna-design-cell-title{font-size:11px;color:#8b95a1;}' +
            '.pna-design-cell .pna-mini-phone{margin:0;}' +
            '.pna-design-cell .psm-preview-box{justify-content:center;max-width:100%;}' +
            '.pna-preview-one{max-width:220px;min-width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pna-mini-phone{width:120px;height:150px;border:5px solid #1d232a;border-radius:16px;position:relative;background:#f4f6f8;margin:6px auto 0;}' +
            '.pna-mini-fab{position:absolute;bottom:10px;left:calc(50% - 20px);width:40px;height:40px;display:flex;align-items:center;justify-content:center;}' +
            '.pna-mini-fab svg{width:20px;height:20px;}' +
            '.psm-dialog.pna-design-dialog{width:520px;}' +
            '.pna-design-hint{font-size:12px;color:#6b7684;margin:8px 0 0 0;}' +
            '@media (max-width:640px){.pna-design-grid{grid-template-columns:1fr;}.pna-preview-grid{grid-template-columns:1fr;justify-items:center;}}' +
            '@media (max-width:600px){' +
            '.psm-dialog.pna-design-dialog{width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0;}' +
            '.pna-swatches{gap:8px;}' +
            '.pna-seg{display:flex;}' +
            '.pna-seg button{flex:1;padding:10px 6px;}' +
            '}';
        document.head.appendChild(style);
    }

    function applyPreviewBtn(b, theme, shape) {
        b.style.background = theme.grad;
        b.style.boxShadow = theme.shadow;
        b.style.borderRadius = shape.radius;
    }
    function swatchGroup(current, gradKey, onPick) {
        var wrap = adminEl('div', 'pna-swatches');
        THEMES.forEach(function (t) {
            var b = adminEl('button', 'pna-swatch' + (t.name === current ? ' sel' : ''));
            var chip = adminEl('span', 'pna-chip');
            chip.style.background = t[gradKey];
            b.appendChild(chip);
            b.appendChild(adminEl('span', '', t.label));
            b.setAttribute('data-pna-pick', 'sw:' + t.name);
            b.onclick = function () { onPick(t.name); };
            wrap.appendChild(b);
        });
        return wrap;
    }
    function segGroup(list, current, onPick) {
        var seg = adminEl('div', 'pna-seg');
        list.forEach(function (s) {
            var b = adminEl('button', s.name === current ? 'on' : '', s.label);
            b.setAttribute('data-pna-pick', 'seg:' + s.name);
            b.onclick = function () { onPick(s.name); };
            seg.appendChild(b);
        });
        return seg;
    }
    function fieldLabel(text, topGap) {
        var l = adminEl('p', 'psm-field-label', text);
        if (topGap) l.style.marginTop = '12px';
        return l;
    }
    /** ショートカットボタンのプレビュー（先頭1件のラベルだけを1ボタンで表示。空なら「ショートカット」）。 */
    function buildShortcutPreview(labels, theme, shape) {
        var box = adminEl('div', 'psm-preview-box');
        var text = (labels && labels[0]) || 'ショートカット';
        var b = adminEl('div', 'psm-preview-btn pna-preview-one', text);
        applyPreviewBtn(b, theme, shape);
        box.appendChild(b);
        return box;
    }
    /** ホームボタン（モバイル）のプレビュー。 */
    function buildHomePreview(theme, homeShapeName) {
        var phone = adminEl('div', 'pna-mini-phone');
        var fab = adminEl('div', 'pna-mini-fab');
        fab.innerHTML = HOME_SVG; // 固定のSVG文字列のみ
        fab.style.background = theme.homeGrad;
        fab.style.boxShadow = theme.homeShadow;
        fab.style.borderRadius = homeShapeByName(homeShapeName).radius;
        phone.appendChild(fab);
        return phone;
    }

    /**
     * 保存済み設定（items）に含まれるスペースのうち、候補一覧（spaces）に無いものを個別に解決して spaces に追加する。
     * アプリを1つも持たないスペースは apps.json の spaceId から辿れないため、この処理なしでは
     * 「（利用できません）」「（不明なスペース）」と誤表示される。個人用モーダルと管理者画面で共用する。
     * 取得に失敗したものは解決しない。成否にかかわらず onDone は必ず1回だけ呼ぶ。
     */
    function resolveMissingSpaceCandidates(spaces, items, onDone) {
        var known = {};
        var i;
        for (i = 0; i < spaces.length; i++) {
            known[spaces[i].id] = true;
        }
        var missing = [];
        for (i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.type !== TARGET_TYPE_SPACE || !item.targetId) continue;
            if (known[item.targetId]) continue;
            known[item.targetId] = true;
            if (spaceNameCache[item.targetId]) {
                // 同一セッションで取得済みなら API を呼ばずに候補へ戻す
                spaces.push({ id: item.targetId, name: spaceNameCache[item.targetId] });
                continue;
            }
            missing.push(item.targetId);
        }
        function sortSpaces() {
            spaces.sort(function (a, b) {
                return a.name.localeCompare(b.name, 'ja');
            });
            spaceListCache = spaces;
        }
        if (!missing.length) {
            sortSpaces();
            onDone();
            return;
        }
        var remaining = missing.length;
        var finishOne = function () {
            remaining--;
            if (remaining <= 0) {
                sortSpaces();
                onDone();
            }
        };
        missing.forEach(function (spaceId) {
            fetchSpaceById(spaceId, function (space) {
                spaces.push(space);
                finishOne();
            }, function () {
                // 本当に削除済み・権限なし。従来どおり「利用できません」系の表示に委ねる
                finishOne();
            });
        });
    }

    // ============================================================
    // 個人カスタマイズ: 設定モーダル本体
    // ============================================================
    var isModalOpen = false; // 多重クリックによる二重オープン防止
    var modalInstanceCounter = 0; // 保存先ラジオの name 属性をモーダルごとに一意にするための連番

    /**
     * ⚙️ モーダルを開く。
     * @param {Function} onSaved 保存成功時に呼ばれるコールバック（ショートカットの即時再描画用）
     */
    function openShortcutSettingsModal(onSaved) {
        if (isModalOpen) return;
        isModalOpen = true;
        injectModalStyle();
        // 保存時の baseRev をなるべく最新にするため、開いたときに全体設定を取り直す（キャッシュが新しければ何もしない）
        refreshGlobalSettings(false);

        var resolution = loadShortcutResolution();
        var designResolution = currentDesign();
        var savedList = resolution.list;
        // 作業コピー（保存前の編集はここにのみ反映し、キャンセル時は破棄する）
        var workingList = savedList.map(function (item) {
            return { type: item.type, targetId: item.targetId, targetName: item.targetName, label: item.label, labelCustom: item.labelCustom };
        });
        var dirty = false;
        var loadedApps = [];
        var loadedSpaces = [];
        var selectedMode = getStorageMode(); // 保存先モード（'app'=共有 / 'local'=この端末だけ）。既定は共有。

        // 現在のテーマ・形状（🎨 のデザイン設定の値）。モーダルの配色とプレビューに使う。
        var theme = getCurrentTheme();
        var shape = getCurrentShape();

        var overlay = document.createElement('div');
        overlay.className = 'psm-overlay';
        // テーマ色を CSS カスタムプロパティとして注入する（CSS は1度だけ注入したまま色だけ差し替える）。
        overlay.style.setProperty('--psm-grad', toBackgroundImage(theme.grad));
        overlay.style.setProperty('--psm-base', theme.base);
        overlay.style.setProperty('--psm-tint', theme.tint);

        var dialog = document.createElement('div');
        dialog.className = 'psm-dialog';
        overlay.appendChild(dialog);

        var header = document.createElement('div');
        header.className = 'psm-header';
        var title = document.createElement('h2');
        title.className = 'psm-title';
        title.textContent = 'ショートカット設定';
        var closeBtn = document.createElement('button');
        closeBtn.className = 'psm-close';
        closeBtn.textContent = '×';
        closeBtn.title = '閉じる';
        header.appendChild(title);
        header.appendChild(closeBtn);
        dialog.appendChild(header);

        var body = document.createElement('div');
        body.className = 'psm-body';
        dialog.appendChild(body);

        var introMsg = document.createElement('p');
        introMsg.className = 'psm-intro';
        introMsg.textContent = '「登録する遷移先」でアプリまたはスペースを選び、「ボタンに表示する名前」でポータルに表示される文字を決めます。';
        body.appendChild(introMsg);

        // 強制反映で個人設定が無効になっているときの案内
        if (resolution.forced) {
            var forcedMsg = document.createElement('p');
            forcedMsg.className = 'psm-warn';
            forcedMsg.textContent = '管理者設定が適用されています（以前の個人設定は無効になりました）。保存し直すと、あなたの設定が再び優先されます。';
            body.appendChild(forcedMsg);
        }
        if (designResolution.forced) {
            var forcedDesignMsg = document.createElement('p');
            forcedDesignMsg.className = 'psm-warn';
            forcedDesignMsg.textContent = '色・形は管理者設定が適用されています。';
            body.appendChild(forcedDesignMsg);
        }

        var errorMsg = document.createElement('p');
        errorMsg.className = 'psm-error';
        errorMsg.style.display = 'none';
        body.appendChild(errorMsg);

        var loadingMsg = document.createElement('div');
        loadingMsg.className = 'psm-loading';
        loadingMsg.textContent = 'アプリ・スペース一覧を取得しています...';
        body.appendChild(loadingMsg);

        // --- 完成イメージ（プレビュー）。アプリ一覧の取得後に表示する ---
        var previewWrap = document.createElement('div');
        previewWrap.style.display = 'none';
        var previewLabel = document.createElement('p');
        previewLabel.className = 'psm-field-label';
        previewLabel.textContent = '完成イメージ';
        previewWrap.appendChild(previewLabel);
        var previewBox = document.createElement('div');
        previewBox.className = 'psm-preview-box';
        previewWrap.appendChild(previewBox);
        body.appendChild(previewWrap);

        var rowsContainer = document.createElement('div');
        rowsContainer.style.display = 'none';
        body.appendChild(rowsContainer);

        // --- スペースURL/ID貼り付け（C: フォールバック）。一覧に無いスペースを候補に追加する ---
        var spaceAddWrap = document.createElement('div');
        spaceAddWrap.className = 'psm-space-add';
        spaceAddWrap.style.display = 'none'; // rowsContainer と同様、アプリ・スペース一覧取得後に表示する

        var spaceAddHeading = document.createElement('div');
        spaceAddHeading.className = 'psm-sync-heading';
        spaceAddHeading.textContent = '一覧に無いスペースを追加';
        spaceAddWrap.appendChild(spaceAddHeading);

        var spaceAddRow = document.createElement('div');
        spaceAddRow.className = 'psm-space-add-row';

        var spaceAddInput = document.createElement('input');
        spaceAddInput.type = 'text';
        spaceAddInput.className = 'psm-input';
        spaceAddInput.placeholder = 'スペースのURL または スペースID';
        spaceAddRow.appendChild(spaceAddInput);

        var spaceAddBtn = document.createElement('button');
        spaceAddBtn.className = 'psm-btn';
        spaceAddBtn.textContent = '候補に追加';
        spaceAddRow.appendChild(spaceAddBtn);

        spaceAddWrap.appendChild(spaceAddRow);

        var spaceAddNote = document.createElement('p');
        spaceAddNote.className = 'psm-space-add-note';
        spaceAddNote.textContent = 'アプリが1つも無いスペースは一覧に出ません。スペースのURLを貼り付けて追加してください。';
        spaceAddWrap.appendChild(spaceAddNote);

        var spaceAddMsg = document.createElement('p');
        spaceAddMsg.className = 'psm-space-add-msg';
        spaceAddWrap.appendChild(spaceAddMsg);

        function showSpaceAddMsg(msg, isSuccess) {
            spaceAddMsg.textContent = msg || '';
            spaceAddMsg.style.color = isSuccess ? '#2d7a4f' : '#c0392b';
        }

        spaceAddBtn.onclick = function () {
            showSpaceAddMsg('', true);
            var spaceId = extractSpaceIdFromInput(spaceAddInput.value);
            if (!spaceId) {
                showSpaceAddMsg('スペースのURLまたはIDを正しく入力してください。', false);
                return;
            }
            for (var i = 0; i < loadedSpaces.length; i++) {
                if (loadedSpaces[i].id === spaceId) {
                    showSpaceAddMsg('このスペースは既に一覧にあります。', true);
                    return;
                }
            }
            spaceAddBtn.disabled = true;
            fetchSpaceById(spaceId, function (space) {
                spaceAddBtn.disabled = false;
                loadedSpaces.push(space);
                loadedSpaces.sort(function (a, b) {
                    return a.name.localeCompare(b.name, 'ja');
                });
                spaceListCache = loadedSpaces;
                renderRows();
                showSpaceAddMsg('『' + space.name + '』を候補に追加しました。', true);
                spaceAddInput.value = '';
            }, function () {
                spaceAddBtn.disabled = false;
                showSpaceAddMsg('スペースが見つからないか、閲覧権限がありません。', false);
            });
        };

        body.appendChild(spaceAddWrap);

        /**
         * 作業コピーの内容から、ポータルに表示されるボタンの完成イメージを描き直す。
         * 色（テーマ）と角丸（形状）は実物と同じ値を使い、サイズのみ縮小する。
         */
        function renderPreview() {
            removeAllChildren(previewBox);
            workingList.forEach(function (item) {
                if (!item.targetId) {
                    var empty = document.createElement('div');
                    empty.className = 'psm-preview-empty';
                    empty.textContent = '未選択';
                    previewBox.appendChild(empty);
                    return;
                }
                var btn = document.createElement('div');
                btn.className = 'psm-preview-btn';
                // 実際のボタン描画と同じ優先順。ただしIDは画面に出さない。スペースのみ先頭に 📁 を付ける。
                var text = item.label || item.targetName || '（未設定）';
                btn.textContent = (item.type === TARGET_TYPE_SPACE ? '📁 ' : '') + text;
                btn.style.background = theme.grad;
                btn.style.boxShadow = theme.shadow;
                btn.style.borderRadius = shape.radius;
                previewBox.appendChild(btn);
            });
        }

        // --- 保存先セグメントコントロール（同期機能が有効な場合のみ表示） ---
        // ラジオボタン自体は残し（キーボード操作・支援技術のため）、視覚的に隠して
        // label をボタン状に見せる。選択状態は change ハンドラでクラスを付け替える。
        var syncSection = null;
        var segLabelApp = null;
        var segLabelLocal = null;
        if (isSyncAvailable()) {
            modalInstanceCounter++;
            var syncRadioName = 'psm-sync-mode-' + modalInstanceCounter;

            syncSection = document.createElement('div');
            syncSection.className = 'psm-sync-section';
            syncSection.style.display = 'none'; // rowsContainer と同様、アプリ一覧取得後に表示する

            var syncHeading = document.createElement('div');
            syncHeading.className = 'psm-sync-heading';
            syncHeading.textContent = 'この設定の保存先';
            syncSection.appendChild(syncHeading);

            var segGroup = document.createElement('div');
            segGroup.className = 'psm-seg';

            var buildSegOption = function (value, text) {
                var label = document.createElement('label');
                label.className = 'psm-seg-option';
                var radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = syncRadioName;
                radio.value = value;
                var caption = document.createElement('span');
                caption.textContent = text;
                label.appendChild(radio);
                label.appendChild(caption);
                label.radioEl = radio;
                segGroup.appendChild(label);
                return label;
            };

            segLabelApp = buildSegOption(SYNC_MODE_APP, 'すべての端末で共有');
            segLabelLocal = buildSegOption(SYNC_MODE_LOCAL, 'この端末だけ');

            var updateSegActive = function () {
                if (selectedMode === SYNC_MODE_LOCAL) {
                    segLabelLocal.className = 'psm-seg-option psm-seg-active';
                    segLabelApp.className = 'psm-seg-option';
                } else {
                    segLabelApp.className = 'psm-seg-option psm-seg-active';
                    segLabelLocal.className = 'psm-seg-option';
                }
            };

            if (selectedMode === SYNC_MODE_LOCAL) {
                segLabelLocal.radioEl.checked = true;
            } else {
                segLabelApp.radioEl.checked = true;
            }
            updateSegActive();

            segLabelApp.radioEl.addEventListener('change', function () {
                if (segLabelApp.radioEl.checked) {
                    selectedMode = SYNC_MODE_APP;
                    dirty = true;
                    updateSegActive();
                }
            });
            segLabelLocal.radioEl.addEventListener('change', function () {
                if (segLabelLocal.radioEl.checked) {
                    selectedMode = SYNC_MODE_LOCAL;
                    dirty = true;
                    updateSegActive();
                }
            });

            syncSection.appendChild(segGroup);

            var syncNote = document.createElement('p');
            syncNote.className = 'psm-sync-note';
            syncNote.textContent = '「すべての端末で共有」を選ぶと、PC・スマホで同じ内容になります。';
            syncSection.appendChild(syncNote);

            body.appendChild(syncSection);
        }

        var footer = document.createElement('div');
        footer.className = 'psm-footer';
        var footerLeft = document.createElement('div');
        footerLeft.className = 'psm-footer-left';
        var footerRight = document.createElement('div');
        footerRight.className = 'psm-footer-right';
        footer.appendChild(footerLeft);
        footer.appendChild(footerRight);
        dialog.appendChild(footer);

        var addBtn = document.createElement('button');
        addBtn.className = 'psm-btn';
        addBtn.textContent = '＋ 追加';
        var resetBtn = document.createElement('button');
        resetBtn.className = 'psm-btn';
        resetBtn.textContent = '既定に戻す';
        footerLeft.appendChild(addBtn);
        footerLeft.appendChild(resetBtn);

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'psm-btn';
        cancelBtn.textContent = 'キャンセル';
        var saveBtn = document.createElement('button');
        saveBtn.className = 'psm-btn psm-btn-primary';
        saveBtn.textContent = '保存';
        footerRight.appendChild(cancelBtn);
        footerRight.appendChild(saveBtn);

        function showError(msg) {
            errorMsg.textContent = msg || '';
            errorMsg.style.display = msg ? 'block' : 'none';
        }

        var prevBodyOverflow = document.body.style.overflow;

        var isClosing = false;

        /**
         * 閉じアニメーションを再生してから DOM を除去する。
         * 多重呼び出し（例: Escape 連打）に備えて isClosing でガードする。
         * isModalOpen の解除は要素の除去と同じタイミングで行い、閉じアニメーション中に
         * 再度開けてしまうのを防ぐ。
         */
        function closeModal() {
            if (isClosing) return;
            isClosing = true;
            document.body.style.overflow = prevBodyOverflow;
            document.removeEventListener('keydown', onKeyDown);
            overlay.className = 'psm-overlay'; // psm-visible を外して逆方向へ遷移させる
            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                isModalOpen = false;
            }, 200);
        }

        function confirmDiscardIfDirty(callback) {
            if (!dirty) { callback(); return; }
            if (window.confirm('編集中の内容が保存されていません。破棄してよろしいですか？')) {
                callback();
            }
        }

        function onKeyDown(e) {
            if (e.key === 'Escape' || e.keyCode === 27) {
                confirmDiscardIfDirty(closeModal);
            }
        }

        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) {
                confirmDiscardIfDirty(closeModal);
            }
        });
        closeBtn.onclick = function () { confirmDiscardIfDirty(closeModal); };
        cancelBtn.onclick = function () { closeModal(); }; // キャンセルは明示的破棄のため確認なし

        /** type/targetId から現在の名称を探す。app は loadedApps、space は loadedSpaces → 無ければ spaceNameCache。 */
        function findTargetName(type, targetId) {
            if (type === TARGET_TYPE_SPACE) {
                for (var s = 0; s < loadedSpaces.length; s++) {
                    if (loadedSpaces[s].id === targetId) return loadedSpaces[s].name;
                }
                if (spaceNameCache[targetId]) return spaceNameCache[targetId];
                return null;
            }
            for (var i = 0; i < loadedApps.length; i++) {
                if (loadedApps[i].id === targetId) return loadedApps[i].name;
            }
            return null;
        }

        /**
         * 保存済みの名称スナップショットを最新の名称へ追従させる。
         * ユーザーが独自の表示名を付けている行（labelCustom）は表示名を変更しない。
         */
        function refreshTargetNames() {
            workingList.forEach(function (item) {
                if (!item.targetId) return;
                var latest = findTargetName(item.type, item.targetId);
                if (!latest || latest === item.targetName) return;
                if (!item.labelCustom) item.label = latest;
                item.targetName = latest;
            });
        }

        function updateFooterState() {
            addBtn.disabled = (workingList.length >= MAX_SHORTCUTS);
        }

        /** select の value（複合キー "type:targetId"）を {type,targetId} へ戻す。不正な形式は null。 */
        function parseTargetValue(value) {
            if (!value) return null;
            var sepIdx = value.indexOf(':');
            if (sepIdx < 1) return null;
            var type = value.slice(0, sepIdx);
            var targetId = value.slice(sepIdx + 1);
            if ((type !== TARGET_TYPE_APP && type !== TARGET_TYPE_SPACE) || !targetId) return null;
            return { type: type, targetId: targetId };
        }

        /**
         * 保存済み設定に含まれるスペースのうち、候補一覧（loadedSpaces）に無いものを個別に解決する。
         * アプリを1つも持たないスペースは apps.json の spaceId から辿れないため、URL貼り付けで登録した
         * スペースがこの処理なしでは次回オープン時に「（利用できません）」と誤表示されてしまう。
         * 取得に失敗したものは解決せず、従来どおり「（利用できません）」として扱う。
         * 成否にかかわらず onDone は必ず1回だけ呼ぶ。
         */
        function resolveMissingSpaces(onDone) {
            resolveMissingSpaceCandidates(loadedSpaces, workingList, onDone);
        }

        function buildRow(item, index) {
            var row = document.createElement('div');
            row.className = 'psm-row';

            var badge = document.createElement('div');
            badge.className = 'psm-row-badge';
            badge.textContent = String(index + 1);
            row.appendChild(badge);

            var main = document.createElement('div');
            main.className = 'psm-row-main';

            var appFieldId = 'psm-app-select-' + index;
            var labelFieldId = 'psm-label-input-' + index;

            var appField = document.createElement('div');
            appField.className = 'psm-field';

            var appFieldLabel = document.createElement('label');
            appFieldLabel.className = 'psm-field-label';
            appFieldLabel.setAttribute('for', appFieldId);
            appFieldLabel.textContent = '登録する遷移先';
            appField.appendChild(appFieldLabel);

            var select = document.createElement('select');
            select.className = 'psm-select';
            select.id = appFieldId;

            var placeholderOpt = document.createElement('option');
            placeholderOpt.value = '';
            placeholderOpt.textContent = 'アプリ・スペースを選択してください';
            select.appendChild(placeholderOpt);

            var unavailableEl = null;
            var unavailableOpt = null;
            var isSpaceItem = (item.type === TARGET_TYPE_SPACE);
            if (item.targetId && !findTargetName(item.type, item.targetId)) {
                // 削除済み・権限なしの遷移先を select が勝手に別の値へ変えてしまわないよう、
                // 選択中のIDを保持する一時的な option を先頭付近に差し込んでおく。
                unavailableOpt = document.createElement('option');
                unavailableOpt.value = item.type + ':' + item.targetId;
                // IDは画面に出さないため、名称が不明な場合も汎用文言にとどめる
                unavailableOpt.textContent = (item.targetName || (isSpaceItem ? '選択中のスペース' : '選択中のアプリ')) + '（利用できません）';
                select.appendChild(unavailableOpt);

                unavailableEl = document.createElement('div');
                unavailableEl.className = 'psm-warn';
                unavailableEl.textContent = isSpaceItem
                    ? 'このスペースは利用できません（削除済み、または閲覧権限がありません）。差し替えてください。'
                    : 'このアプリは利用できません（削除済み、または閲覧権限がありません）。差し替えてください。';
            }

            // loadedApps は fetchAllApps 成功時に一度だけアプリ名順にソート済み。
            var appGroup = document.createElement('optgroup');
            appGroup.label = 'アプリ';
            for (var optIdx = 0; optIdx < loadedApps.length; optIdx++) {
                var appOpt = document.createElement('option');
                appOpt.value = TARGET_TYPE_APP + ':' + loadedApps[optIdx].id;
                appOpt.textContent = loadedApps[optIdx].name;
                appGroup.appendChild(appOpt);
            }
            select.appendChild(appGroup);

            // loadedSpaces が1件以上ある場合のみ「スペース」optgroup を追加する。
            if (loadedSpaces.length > 0) {
                var spaceGroup = document.createElement('optgroup');
                spaceGroup.label = 'スペース';
                for (var spIdx = 0; spIdx < loadedSpaces.length; spIdx++) {
                    var spaceOpt = document.createElement('option');
                    spaceOpt.value = TARGET_TYPE_SPACE + ':' + loadedSpaces[spIdx].id;
                    spaceOpt.textContent = loadedSpaces[spIdx].name;
                    spaceGroup.appendChild(spaceOpt);
                }
                select.appendChild(spaceGroup);
            }

            select.value = item.targetId ? (item.type + ':' + item.targetId) : '';
            appField.appendChild(select);
            if (unavailableEl) appField.appendChild(unavailableEl);
            main.appendChild(appField);

            var labelField = document.createElement('div');
            labelField.className = 'psm-field';

            var labelFieldLabel = document.createElement('label');
            labelFieldLabel.className = 'psm-field-label';
            labelFieldLabel.setAttribute('for', labelFieldId);
            labelFieldLabel.textContent = 'ボタンに表示する名前';
            labelField.appendChild(labelFieldLabel);

            var labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.className = 'psm-input';
            labelInput.id = labelFieldId;
            labelInput.placeholder = '未入力の場合はアプリ名を表示します';
            labelInput.value = item.label || '';
            labelField.appendChild(labelInput);
            main.appendChild(labelField);

            var actions = document.createElement('div');
            actions.className = 'psm-row-actions';

            var upBtn = document.createElement('button');
            upBtn.className = 'psm-icon-btn';
            upBtn.textContent = '↑';
            upBtn.title = '上へ移動';
            upBtn.disabled = (index === 0);

            var downBtn = document.createElement('button');
            downBtn.className = 'psm-icon-btn';
            downBtn.textContent = '↓';
            downBtn.title = '下へ移動';
            downBtn.disabled = (index === workingList.length - 1);

            var deleteBtn = document.createElement('button');
            deleteBtn.className = 'psm-icon-btn';
            deleteBtn.textContent = '削除';
            deleteBtn.disabled = (workingList.length <= MIN_SHORTCUTS);
            deleteBtn.title = deleteBtn.disabled
                ? 'これ以上減らせません（最少' + MIN_SHORTCUTS + '個）'
                : 'この行を削除';

            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            actions.appendChild(deleteBtn);

            row.appendChild(main);
            row.appendChild(actions);

            select.addEventListener('change', function () {
                var parsedValue = parseTargetValue(select.value);
                if (!parsedValue) {
                    // プレースホルダーが選ばれた場合は未選択として扱う（保存時バリデーションで弾かれる）
                    item.targetId = '';
                    item.type = TARGET_TYPE_APP;
                    dirty = true;
                    renderPreview();
                    return;
                }
                var newType = parsedValue.type;
                var newTargetId = parsedValue.targetId;
                var targetName = findTargetName(newType, newTargetId) || '';
                var wasAutoLabel = !item.labelCustom;
                item.type = newType;
                item.targetId = newTargetId;
                item.targetName = targetName;
                if (wasAutoLabel || !labelInput.value) {
                    item.label = targetName;
                    labelInput.value = targetName;
                    item.labelCustom = false;
                }
                if (unavailableEl && unavailableEl.parentNode) {
                    unavailableEl.parentNode.removeChild(unavailableEl);
                    unavailableEl = null;
                }
                // 利用できない遷移先を選び直した後は、その選択肢自体も取り除く
                if (unavailableOpt && unavailableOpt.parentNode && unavailableOpt.value !== select.value) {
                    unavailableOpt.parentNode.removeChild(unavailableOpt);
                    unavailableOpt = null;
                }
                dirty = true;
                renderPreview();
            });

            labelInput.addEventListener('input', function () {
                item.label = labelInput.value;
                item.labelCustom = (labelInput.value !== item.targetName);
                dirty = true;
                renderPreview();
            });

            upBtn.onclick = function () {
                if (index === 0) return;
                var tmp = workingList[index - 1];
                workingList[index - 1] = workingList[index];
                workingList[index] = tmp;
                dirty = true;
                renderRows();
            };
            downBtn.onclick = function () {
                if (index === workingList.length - 1) return;
                var tmp = workingList[index + 1];
                workingList[index + 1] = workingList[index];
                workingList[index] = tmp;
                dirty = true;
                renderRows();
            };
            deleteBtn.onclick = function () {
                if (workingList.length <= MIN_SHORTCUTS) return;
                workingList.splice(index, 1);
                dirty = true;
                renderRows();
            };

            return row;
        }

        function renderRows() {
            removeAllChildren(rowsContainer);
            workingList.forEach(function (item, index) {
                rowsContainer.appendChild(buildRow(item, index));
            });
            updateFooterState();
            // 並び替え・追加・削除・既定に戻す は renderRows を経由するため、ここで一括して追従させる
            renderPreview();
        }

        addBtn.onclick = function () {
            if (workingList.length >= MAX_SHORTCUTS) return;
            workingList.push({ type: TARGET_TYPE_APP, targetId: '', targetName: '', label: '', labelCustom: false });
            dirty = true;
            renderRows();
            var selects = rowsContainer.querySelectorAll('.psm-select');
            if (selects.length) selects[selects.length - 1].focus(); // 追加行のアプリ選択欄
        };

        resetBtn.onclick = function () {
            var useRemoteDelete = isSyncAvailable() && selectedMode === SYNC_MODE_APP;
            var confirmMsg = useRemoteDelete
                ? '保存済みのショートカット設定を削除し、既定のアプリ一覧に戻します。すべての端末の設定が既定に戻ります。よろしいですか？'
                : '保存済みのショートカット設定を削除し、既定のアプリ一覧に戻します。よろしいですか？';
            if (!window.confirm(confirmMsg)) return;

            if (!useRemoteDelete) {
                resetShortcutSettings();
                dirty = false;
                closeModal();
                onSaved();
                return;
            }

            // 共有モード: リモートのレコードを削除できてからローカルキャッシュを削除する
            // （中途半端な状態を避けるため、失敗時はどちらも削除しない）。
            resetBtn.disabled = true;
            deleteRemote(function () {
                resetShortcutSettings();
                resetBtn.disabled = false;
                dirty = false;
                closeModal();
                onSaved();
            }, function (err) {
                console.error('portal-navigation: リモート設定の削除に失敗しました。', err);
                resetBtn.disabled = false;
                showError('既定に戻す処理に失敗しました。ネットワーク状況をご確認のうえ、再度お試しください。');
            });
        };

        saveBtn.onclick = function () {
            showError('');
            for (var i = 0; i < workingList.length; i++) {
                if (!workingList[i].targetId) {
                    showError('すべての行で遷移先（アプリ／スペース）を選択してください。');
                    return;
                }
            }
            if (workingList.length < MIN_SHORTCUTS || workingList.length > MAX_SHORTCUTS) {
                showError('ショートカットは' + MIN_SHORTCUTS + '〜' + MAX_SHORTCUTS + '個にしてください。');
                return;
            }

            if (!isSyncAvailable() || selectedMode === SYNC_MODE_LOCAL) {
                try {
                    saveShortcutSettings(workingList);
                } catch (e) {
                    showError((e && e.message) ? e.message : '保存に失敗しました。');
                    return;
                }
                setStorageMode(SYNC_MODE_LOCAL);
                dirty = false;
                closeModal();
                onSaved();
                return;
            }

            // 共有モード: まずリモート（設定アプリ）へ保存し、成功後にローカルキャッシュを更新する。
            var originalSaveLabel = saveBtn.textContent;
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';

            saveRemote(workingList, function () {
                try {
                    saveShortcutSettings(workingList);
                } catch (e) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalSaveLabel;
                    showError((e && e.message) ? e.message : '保存に失敗しました。');
                    return;
                }
                setStorageMode(SYNC_MODE_APP);
                dirty = false;
                closeModal();
                onSaved();
            }, function (err) {
                console.error('portal-navigation: リモートへの保存に失敗しました。', err);
                saveBtn.disabled = false;
                saveBtn.textContent = originalSaveLabel;
                showError('設定の保存に失敗しました。ネットワーク状況をご確認いただくか、「この端末だけに保存する」を選んで再度お試しください。');
            });
        };

        // --- 管理者設定の入口（全体設定が使えて、全体設定レコードを編集できる人にだけ表示する） ---
        // 初回はキャッシュに recordId が無いため、取得の完了後にもう一度判定する。
        var adminEntryAdded = false;
        function tryAddAdminEntry() {
            if (adminEntryAdded || isClosing || !isGlobalAvailable()) return;
            checkAdminRights(function (rights) {
                if (!rights || rights.editable !== true || isClosing || adminEntryAdded) return;
                adminEntryAdded = true;
                injectAdminStyle();
                var adminBtn = document.createElement('button');
                adminBtn.className = 'psm-link-admin';
                adminBtn.textContent = '🔒 管理者設定';
                adminBtn.title = '全ユーザーの既定値を変更します（管理者のみ）';
                adminBtn.onclick = function () {
                    confirmDiscardIfDirty(function () {
                        closeModal();
                        setTimeout(openAdminEntry, 220);
                    });
                };
                footerLeft.appendChild(adminBtn);
            });
        }
        tryAddAdminEntry();
        refreshGlobalSettings(false, null, tryAddAdminEntry);

        // --- 画面へ追加＆背景スクロール抑止 ---
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);

        // 開くアニメーション: DOM 追加の1フレーム後にクラスを付けて遷移させる
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () {
                overlay.className = 'psm-overlay psm-visible';
            });
        } else {
            setTimeout(function () { overlay.className = 'psm-overlay psm-visible'; }, 16);
        }

        // --- アプリ一覧取得（モーダルを開いた時のみ） ---
        fetchAllApps(function (apps) {
            loadedApps = apps;
            // スペース候補の取得が全件失敗しても、アプリ候補だけでモーダルが開けることが受け入れ条件。
            // fetchAllSpaces はエラーコールバックを持たず、失敗は静かに除外されて空配列で完了する。
            fetchAllSpaces(function (spaces) {
                loadedSpaces = spaces;
                // 候補一覧に出ないスペース（アプリを持たないスペース）を保存済み設定から解決してから描画する。
                resolveMissingSpaces(function () {
                    refreshTargetNames();
                    loadingMsg.style.display = 'none';
                    previewWrap.style.display = 'block';
                    rowsContainer.style.display = 'block';
                    spaceAddWrap.style.display = 'block';
                    if (syncSection) syncSection.style.display = 'block';
                    renderRows();
                    var firstSelect = rowsContainer.querySelector('.psm-select');
                    if (firstSelect) firstSelect.focus();
                });
            });
        }, function () {
            loadingMsg.style.display = 'none';
            showError('アプリ・スペース一覧の取得に失敗しました。時間をおいて再度お試しください。既存の設定は変更されていません。');
            addBtn.disabled = true;
            resetBtn.disabled = true;
            saveBtn.disabled = true;
        });
    }

    // ============================================================
    // 7b. デザイン設定モーダル（🎨）
    // ============================================================
    var isDesignModalOpen = false; // 多重クリックによる二重オープン防止

    /**
     * 🎨 のデザイン設定モーダルを開く。ショートカットの色・形を選ぶ（ホームボタンはそれに連動）。
     * @param {Function} onSaved 保存・既定に戻す成功時に呼ばれるコールバック（即時再描画用）
     */
    function openDesignSettingsModal(onSaved) {
        if (isDesignModalOpen) return;
        isDesignModalOpen = true;
        var m = null;
        try {
            injectModalStyle();
            injectDesignPartsStyle();
            refreshGlobalSettings(false); // 保存時の design_rev をなるべく新しくする
            m = openOverlayFrame('pna-design-dialog', 'デザイン設定', null, 'psm-header');
            m.afterClose = function () { isDesignModalOpen = false; };
            buildDesignSettings(m, onSaved);
        } catch (e) {
            // 途中で失敗してもフラグを残さない（残ると再読み込みまで 🎨 が開けなくなる）
            isDesignModalOpen = false;
            if (m) m.close();
            console.error('[portal-nav] デザイン設定を開けませんでした', e);
        }
    }

    /** デザイン設定モーダルの中身を組み立てる（openDesignSettingsModal から呼ぶ）。 */
    function buildDesignSettings(m, onSaved) {
        var initial = currentDesign();
        var draft = { scTheme: initial.scTheme, scShape: initial.scShape };
        var labels = loadShortcutSettings().map(function (it) { return it.label || it.targetName || it.targetId; });

        function isDirty() {
            return draft.scTheme !== initial.scTheme || draft.scShape !== initial.scShape;
        }
        function done() {
            m.onClose = null;
            m.close();
            if (onSaved) onSaved();
        }

        // --- フッター ---
        var pd = readPersonalDesign();
        var hasPersonal = pd.scThemeIdx != null || pd.scShapeIdx != null || lget(KEY_HOME_THEME_IDX) != null;
        var resetBtn = adminEl('button', 'psm-btn', '管理者の既定に戻す');
        resetBtn.disabled = !hasPersonal;
        resetBtn.onclick = function () {
            if (!window.confirm('自分用の色・形を消して、管理者の既定（全体設定）に戻します。よろしいですか？')) return;
            clearPersonalDesign();
            done();
        };
        m.left.appendChild(resetBtn);
        var cancelBtn = adminEl('button', 'psm-btn', 'キャンセル');
        cancelBtn.onclick = function () { m.close(); };
        var saveBtn = adminEl('button', 'psm-btn psm-btn-primary', '保存');
        saveBtn.onclick = function () {
            if (savePersonalDesign(draft.scTheme, draft.scShape)) done();
        };
        m.right.appendChild(cancelBtn);
        m.right.appendChild(saveBtn);

        // ESC・×・背景クリック: 未保存の変更があれば破棄の確認を出す
        m.onClose = function () {
            if (isDirty() && !window.confirm('編集中の内容が保存されていません。破棄してよろしいですか？')) return;
            m.close();
        };

        function render() {
            // 作り直しでキーボードフォーカスが失われないよう、フォーカス中の選択ボタンを覚えて戻す
            var focusKey = null;
            var ae = document.activeElement;
            if (ae && ae.getAttribute) focusKey = ae.getAttribute('data-pna-pick');
            removeAllChildren(m.body);
            var theme = THEMES[themeIndexByName(draft.scTheme)];
            var shape = SHAPES[shapeIndexByName(draft.scShape)];
            m.body.appendChild(adminEl('p', 'psm-intro', 'ショートカットボタンの色と形を選べます。この端末（ブラウザ）だけに保存されます。'));
            if (initial.forced) {
                m.body.appendChild(adminEl('p', 'psm-warn', '色・形は管理者設定が適用されています（以前の個人設定は無効になりました）。色か形を変えると保存できます。保存し直すと、あなたの設定が再び優先されます。'));
            }
            var card = adminEl('div', 'pna-card');
            card.appendChild(fieldLabel('色'));
            card.appendChild(swatchGroup(draft.scTheme, 'grad', function (n) { draft.scTheme = n; render(); }));
            card.appendChild(fieldLabel('形', true));
            card.appendChild(segGroup(SHAPES, draft.scShape, function (n) { draft.scShape = n; render(); }));
            card.appendChild(fieldLabel('プレビュー', true));
            var grid = adminEl('div', 'pna-preview-grid');
            var cellSc = adminEl('div', 'pna-design-cell');
            cellSc.appendChild(adminEl('div', 'pna-design-cell-title', 'ショートカット'));
            cellSc.appendChild(buildShortcutPreview(labels, theme, shape));
            var cellHome = adminEl('div', 'pna-design-cell');
            cellHome.appendChild(adminEl('div', 'pna-design-cell-title', 'ホームボタン（モバイル）'));
            cellHome.appendChild(buildHomePreview(theme, homeShapeNameForScShape(draft.scShape)));
            grid.appendChild(cellSc); grid.appendChild(cellHome);
            card.appendChild(grid);
            card.appendChild(adminEl('p', 'pna-design-hint', 'ホームボタン（モバイル）はショートカットと同じ色・形になります。'));
            m.body.appendChild(card);
            // ヘッダーと保存ボタンの色を選択中のテーマに追従させる
            m.overlay.style.setProperty('--psm-grad', toBackgroundImage(theme.grad));
            m.overlay.style.setProperty('--psm-base', theme.base);
            m.overlay.style.setProperty('--psm-tint', theme.tint);
            // 未変更のまま保存すると全体設定の値を個人設定として固定してしまうため、変更があるときだけ押せる
            saveBtn.disabled = !isDirty();
            if (focusKey) {
                var picks = m.body.querySelectorAll('[data-pna-pick]');
                for (var i = 0; i < picks.length; i++) {
                    if (picks[i].getAttribute('data-pna-pick') === focusKey) { picks[i].focus(); break; }
                }
            }
        }
        render();
    }

    // ============================================================
    // 8. ホームボタン部（モバイル。/k/m/ へ戻る丸ボタン。色と形はショートカットの色・形に連動する）
    // ============================================================

    /** ホームボタンに、今の有効な色・形を当てる。既定（navy・丸）なら従来と完全に同じ見た目。 */
    function applyHomeDesign(el) {
        var d = currentDesign();
        var theme = THEMES[themeIndexByName(d.homeTheme)];
        var shape = homeShapeByName(d.homeShape);
        el.style.background = theme.homeGrad;
        el.style.boxShadow = theme.homeShadow;
        el.style.borderRadius = shape.radius;
    }

    /** 統合ファイルが作ったホームボタンがあれば、色・形を当て直す。 */
    function applyHomeDesignToExisting() {
        var el = document.getElementById(HOME_BTN_ID);
        if (el && el.getAttribute(NAV_MARKER_ATTR) === 'true') applyHomeDesign(el);
    }

    function setupHomeButton() {
        // 画面再表示でも遷移中表示を残さない（重複防止の早期returnより前で行う）
        resetTapStates();
        injectHomeTapStyle();

        // 重複防止
        var existing = document.getElementById(HOME_BTN_ID);
        if (existing) {
            // 統合ファイルが作ったものなら色・形だけ当て直す。旧ファイルが作ったものには触れない（重複生成もしない）
            if (existing.getAttribute(NAV_MARKER_ATTR) === 'true') applyHomeDesign(existing);
            return;
        }
        if (!document.body) return;

        // ホームボタン（リンク）を作成
        var homeBtn = document.createElement('a');
        homeBtn.id = HOME_BTN_ID;
        homeBtn.href = HOME_URL; // モバイル版ポータルURL
        homeBtn.setAttribute(NAV_MARKER_ATTR, 'true');
        homeBtn.innerHTML = HOME_SVG; // 固定のSVG文字列のみ（外部入力は入れない）

        // ▼ デザイン設定
        var s = homeBtn.style;
        s.position = 'fixed';
        s.bottom = '16px';           // 少し上に配置（視認性向上）
        s.left = 'calc(50% - 28px)'; // 中央寄せ（幅56px）。transform はタップ演出と競合するため使わない
        s.width = '56px';            // 指で押しやすいサイズ（標準的なFABサイズ）
        s.height = '56px';
        s.display = 'flex';
        s.justifyContent = 'center';
        s.alignItems = 'center';
        s.zIndex = '9999';

        // タップ演出（リップル＋遷移中の進捗バー）
        homeBtn.className = 'mhb-tap';
        attachTapFeedback(homeBtn, true, 'mhb');

        // 色・形（背景・影・角丸）は全体設定と個人設定に従う
        applyHomeDesign(homeBtn);

        // 画面に追加
        document.body.appendChild(homeBtn);
    }


    // ============================================================
    // 9. 管理者認証ユーティリティ（PBKDF2-SHA256 によるパスワード照合・ロック・認証状態）
    //    ※ 画面の入口を守る補助。本当の防御は全体設定アプリの権限（kintone 側）。
    // ============================================================

    function bytesToBase64(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }

    /** base64 文字列を Uint8Array へ。不正な文字列なら例外（atob）を投げる。 */
    function base64ToBytes(str) {
        var s = atob(str);
        var out = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
        return out;
    }

    function tryBase64ToBytes(str) {
        if (typeof str !== 'string' || !str) return null;
        try { return base64ToBytes(str); } catch (e) { return null; }
    }

    /** auth_json 文字列をパース・検証する。形式に合わなければ null。 */
    function parseAuthJson(raw) {
        if (!raw || typeof raw !== 'string') return null;
        var obj;
        try {
            obj = JSON.parse(raw);
        } catch (e) {
            return null;
        }
        if (!obj || typeof obj !== 'object') return null;
        if (obj.v !== 1) return null;
        if (obj.alg !== 'PBKDF2-SHA256') return null;
        if (typeof obj.iter !== 'number' || Math.floor(obj.iter) !== obj.iter || obj.iter < 10000) return null;
        var salt = tryBase64ToBytes(obj.salt);
        var hash = tryBase64ToBytes(obj.hash);
        if (!salt || !salt.length) return null;
        if (!hash || hash.length !== PBKDF2_HASH_BYTES) return null;
        return {
            v: 1, alg: obj.alg, iter: obj.iter, salt: obj.salt, hash: obj.hash,
            updatedBy: (typeof obj.updatedBy === 'string') ? obj.updatedBy : '',
            updatedAt: (typeof obj.updatedAt === 'string') ? obj.updatedAt : ''
        };
    }

    /** @returns {Promise<Uint8Array>} PBKDF2-SHA256 で導出した 32 バイト */
    function hashPassword(password, saltBytes, iterations) {
        var subtle = window.crypto.subtle;
        return subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
            .then(function (key) {
                return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iterations }, key, PBKDF2_HASH_BYTES * 8);
            })
            .then(function (bits) {
                return new Uint8Array(bits);
            });
    }

    /** 長さを確かめてから、全バイトを XOR して比べる（早期 return しない）。 */
    function timingSafeEqual(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        var diff = 0;
        for (var i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
        return diff === 0;
    }

    /** @returns {Promise<Object>} auth_json 形式のオブジェクト（JSON.stringify して保存する） */
    function createAuthRecord(password, displayName) {
        var salt = window.crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
        return hashPassword(password, salt, PBKDF2_ITERATIONS).then(function (hash) {
            return {
                v: 1,
                alg: 'PBKDF2-SHA256',
                iter: PBKDF2_ITERATIONS,
                salt: bytesToBase64(salt),
                hash: bytesToBase64(hash),
                updatedBy: displayName || '',
                updatedAt: new Date().toISOString()
            };
        });
    }

    /** @returns {Promise<boolean>} 保存されている iter / salt で計算し直して照合する */
    function verifyPassword(password, auth) {
        var salt = base64ToBytes(auth.salt);
        var expected = base64ToBytes(auth.hash);
        return hashPassword(password, salt, auth.iter).then(function (actual) {
            return timingSafeEqual(actual, expected);
        });
    }

    /** crypto.subtle が使えるか（HTTPS 等の安全なコンテキストが前提）。 */
    function isCryptoAvailable() {
        return !!(window.crypto && window.crypto.subtle && window.isSecureContext !== false);
    }

    // --- 入力失敗のロック（純関数） ---
    function computeLockState(lockObj, nowMs) {
        var fails = (lockObj && typeof lockObj.fails === 'number') ? lockObj.fails : 0;
        var until = (lockObj && typeof lockObj.until === 'number') ? lockObj.until : 0;
        var remaining = until - nowMs;
        if (remaining > 0) return { locked: true, remainingMs: remaining, fails: fails };
        return { locked: false, remainingMs: 0, fails: fails };
    }

    /** 失敗を1回記録した新しい lockObj を返す。上限に達したらロック時間を設定して失敗回数を 0 に戻す。 */
    function registerFailure(lockObj, nowMs) {
        var state = computeLockState(lockObj, nowMs);
        var fails = state.fails + 1;
        if (fails >= AUTH_MAX_FAILS) return { fails: 0, until: nowMs + AUTH_LOCK_MS };
        return { fails: fails, until: 0 };
    }

    function adminLockKey() { return KEY_ADMIN_LOCK_PREFIX + getUserId(); }
    function adminAuthKey() { return KEY_ADMIN_AUTH_PREFIX + getUserId(); }
    function adminAclKey() { return KEY_ADMIN_ACL_PREFIX + getUserId(); }

    function readLock() {
        var raw = lget(adminLockKey());
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }
    function writeLock(lockObj) { lset(adminLockKey(), JSON.stringify(lockObj)); }
    function clearFailures() { lremove(adminLockKey()); }

    // --- 認証の状態（sessionStorage。30分有効） ---
    function isAuthSessionValid(obj, nowMs, appId) {
        if (!obj || typeof obj !== 'object') return false;
        if (String(obj.appId) !== String(appId)) return false;
        return typeof obj.until === 'number' && obj.until > nowMs;
    }
    function readAuthSession() {
        var raw = sget(adminAuthKey());
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }
    function setAuthSession() {
        sset(adminAuthKey(), JSON.stringify({ appId: String(GLOBAL_SETTINGS_APP_ID), until: Date.now() + AUTH_SESSION_MS }));
    }
    function clearAuthSession() { sremove(adminAuthKey()); }

    /** kintone のレコード更新で revision が一致しなかった（他の人が先に保存した）エラーか。 */
    function isConflictError(err) {
        if (!err) return false;
        if (err.code === 'GAIA_CO02') return true;
        return typeof err.message === 'string' && err.message.indexOf('revision') !== -1;
    }

    /** acl/evaluate の fields（配列 {code,viewable,editable} か、コードをキーにしたオブジェクト）から1フィールドを探す。 */
    function findFieldRight(fields, code) {
        if (!fields) return null;
        if (Array.isArray(fields)) {
            for (var i = 0; i < fields.length; i++) {
                if (fields[i] && fields[i].code === code) return fields[i];
            }
            return null;
        }
        return fields[code] || null;
    }

    /**
     * 管理者権限（全体設定レコードの編集権限・auth_json の閲覧／編集権限）を判定する。
     * 結果は {editable, authViewable, authEditable} か、判定できないとき null。
     * 判定は /k/v1/records/acl/evaluate.json で行い、sessionStorage に10分キャッシュする。
     */
    function checkAdminRights(cb) {
        if (!isGlobalAvailable()) { cb(null); return; }
        var cache = readGlobalCache();
        var appId = String(GLOBAL_SETTINGS_APP_ID);
        if (!cache || cache.appId !== appId || !cache.recordId) { cb(null); return; }
        var recordId = String(cache.recordId);

        var cachedRaw = sget(adminAclKey());
        if (cachedRaw) {
            try {
                var c = JSON.parse(cachedRaw);
                if (c && c.appId === appId && c.recordId === recordId && typeof c.at === 'number' &&
                    Date.now() - c.at >= 0 && Date.now() - c.at < ADMIN_ACL_TTL_MS) {
                    cb({ editable: c.editable === true, authViewable: c.authViewable === true, authEditable: c.authEditable === true });
                    return;
                }
            } catch (e) {
                // キャッシュ破損は無視して取り直す
            }
        }

        kintone.api(kintone.api.url('/k/v1/records/acl/evaluate.json', true), 'GET',
            { app: appId, ids: [recordId] },
            function (resp) {
                var right = (resp && resp.rights && resp.rights.length) ? resp.rights[0] : null;
                if (!right) { cb(null); return; }
                var authRight = findFieldRight(right.fields, FIELD_GLOBAL_AUTH);
                var result = {
                    editable: !!(right.record && right.record.editable === true),
                    authViewable: !!(authRight && authRight.viewable === true),
                    authEditable: !!(authRight && authRight.editable === true)
                };
                sset(adminAclKey(), JSON.stringify({
                    appId: appId, recordId: recordId,
                    editable: result.editable, authViewable: result.authViewable, authEditable: result.authEditable,
                    at: Date.now()
                }));
                cb(result);
            },
            function (err) {
                console.warn('portal-navigation: 管理者権限の判定に失敗しました。', err);
                cb(null);
            }
        );
    }


    // ============================================================
    // 10. 管理者画面（⚙️ → 「🔒 管理者設定」を開いたときに初めて DOM と CSS を作る）
    //     画面仕様の正: モックアップ/管理者設定画面/index.html
    // ============================================================
    var isAdminOpen = false;   // 二重オープン防止
    var adminOverlayStack = []; // 前面にあるオーバーレイだけが ESC に反応するための管理

    function injectAdminStyle() {
        injectDesignPartsStyle();
        if (document.getElementById(ADMIN_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = ADMIN_STYLE_ID;
        style.textContent =
            '.psm-dialog.wide{width:760px;}' +
            '.psm-dialog.narrow{width:400px;}' +
            '.psm-header.admin{background-image:linear-gradient(135deg,#2c3440 0%,#4a5563 100%);}' +
            '.psm-header.admin .psm-title{display:flex;align-items:center;gap:8px;}' +
            '.psm-badge{font-size:11px;background:rgba(255,255,255,.2);border-radius:10px;padding:1px 8px;}' +
            '.psm-btn-dark{padding:9px 18px;border:none;background:#2c3440;color:#fff;}' +
            '.psm-btn-dark:hover:not(:disabled){background:#3b4552;}' +
            '.psm-link-admin{font-size:12px;color:#5b6672;background:none;border:1px dashed #c8d0d8;border-radius:8px;padding:7px 10px;cursor:pointer;}' +
            '.psm-link-admin:hover{background:#f2f5f8;}' +
            '.psm-ok{color:#2d7a4f;font-size:13px;margin:0 0 10px 0;}' +
            '.psm-field{margin-bottom:12px;}' +
            '.pna-lock-icon{font-size:34px;text-align:center;margin:4px 0 8px 0;}' +
            '.pna-lock-text{text-align:center;font-size:13px;color:#5b6672;margin:0 0 16px 0;}' +
            '.pna-tabs{display:flex;gap:2px;background:#fff;border-bottom:1px solid #e6eaef;padding:0 14px;overflow-x:auto;}' +
            '.pna-tab{padding:11px 14px;font-size:13px;color:#5b6672;background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;}' +
            '.pna-tab.active{color:#1a2027;font-weight:600;border-bottom-color:#2c3440;}' +
            '.pna-tab .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#e67e22;margin-left:5px;vertical-align:middle;}' +
            '.pna-meta{font-size:12px;color:#6b7684;background:#fff;border:1px solid #e6eaef;border-radius:8px;padding:8px 12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:4px 18px;}' +
            '.pna-banner{border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:12px;display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;}' +
            '.pna-banner.err{background:#fdecea;color:#a12a1d;border:1px solid #f5c2bc;}' +
            '.pna-banner.ok{background:#e8f5ee;color:#22603e;border:1px solid #bfe2cd;}' +
            '.pna-row{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #e6eaef;border-radius:10px;padding:12px;margin-bottom:8px;flex-wrap:wrap;}' +
            '.pna-num{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:#e3e7ec;color:#2c3440;font-size:11px;display:flex;align-items:center;justify-content:center;margin-top:22px;}' +
            '.pna-main{flex:1;min-width:200px;display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
            '.pna-main .psm-field{margin:0;}' +
            '.pna-acts{display:flex;gap:6px;margin-top:20px;}' +
            '.pna-icon-btn{width:32px;height:32px;padding:0;border:1px solid #e0e5ea;background:#fff;border-radius:8px;cursor:pointer;font-size:12px;color:#6b7684;}' +
            '.pna-icon-btn:disabled{opacity:.35;cursor:not-allowed;}' +
            '.pna-force-item{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid #eef1f4;cursor:pointer;}' +
            '.pna-force-item:first-of-type{border-top:none;}' +
            '.pna-force-item input{margin-top:4px;width:16px;height:16px;}' +
            '.pna-force-item .t{font-size:14px;font-weight:600;}' +
            '.pna-force-item .d{font-size:12px;color:#6b7684;}' +
            '.pna-warn{background:#fff7e6;border:1px solid #f3d9a4;color:#7a5200;border-radius:8px;padding:10px 12px;font-size:12px;}' +
            '.pna-confirm-list{margin:0;padding-left:18px;font-size:13px;}' +
            '.pna-confirm-list li{margin:3px 0;}' +
            '@media (max-width:600px){' +
            '.psm-dialog.wide,.psm-dialog.narrow{width:100%;max-width:100%;max-height:100%;height:100%;border-radius:0;}' +
            '.pna-main{grid-template-columns:1fr;}' +
            '}';
        document.head.appendChild(style);
    }

    /**
     * 管理者画面用の枠。openOverlay と同じ形 {overlay, body, left, right, onClose, close} を返す。
     * ESC と背景クリックで onClose（無ければ close）を呼ぶ。閉じたあと afterClose があれば呼ぶ。
     */
    function openAdminOverlay(dialogClass, titleText, badge) {
        injectModalStyle();
        injectAdminStyle();
        return openOverlayFrame(dialogClass, titleText, badge, 'psm-header admin');
    }

    /**
     * オーバーレイの枠の共通部分（CSS の注入は呼び出し側で行う）。
     * headerClass は 'psm-header admin'（管理者画面）または 'psm-header'（テーマ色のヘッダー）。
     */
    function openOverlayFrame(dialogClass, titleText, badge, headerClass) {
        var theme = getCurrentTheme();

        var overlay = adminEl('div', 'psm-overlay');
        overlay.style.setProperty('--psm-grad', toBackgroundImage(theme.grad));
        overlay.style.setProperty('--psm-base', theme.base);
        overlay.style.setProperty('--psm-tint', theme.tint);
        var dialog = adminEl('div', 'psm-dialog ' + (dialogClass || ''));
        var header = adminEl('div', headerClass);
        var title = adminEl('h2', 'psm-title', titleText);
        if (badge) title.appendChild(adminEl('span', 'psm-badge', badge));
        var closeBtn = adminEl('button', 'psm-close', '×');
        closeBtn.title = '閉じる';
        header.appendChild(title);
        header.appendChild(closeBtn);
        var body = adminEl('div', 'psm-body');
        var footer = adminEl('div', 'psm-footer');
        var footerLeft = adminEl('div', 'psm-footer-left');
        var footerRight = adminEl('div', 'psm-footer-right');
        footer.appendChild(footerLeft);
        footer.appendChild(footerRight);
        dialog.appendChild(header);
        dialog.appendChild(body);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);

        var prevOverflow = document.body.style.overflow;
        var closed = false;
        var api = {
            overlay: overlay, dialog: dialog, body: body, left: footerLeft, right: footerRight,
            onClose: null, afterClose: null,
            close: function () {
                if (closed) return;
                closed = true;
                var at = adminOverlayStack.indexOf(api);
                if (at !== -1) adminOverlayStack.splice(at, 1);
                document.removeEventListener('keydown', onKeyDown);
                document.body.style.overflow = prevOverflow;
                overlay.className = 'psm-overlay'; // psm-visible を外して閉じアニメーションへ
                setTimeout(function () {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }, 200);
                if (api.afterClose) api.afterClose();
            }
        };
        function requestClose() { (api.onClose || api.close)(); }
        function onKeyDown(e) {
            if (e.key !== 'Escape' && e.keyCode !== 27) return;
            if (adminOverlayStack[adminOverlayStack.length - 1] !== api) return;
            requestClose();
        }
        closeBtn.onclick = requestClose;
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) requestClose();
        });
        adminOverlayStack.push(api);
        document.addEventListener('keydown', onKeyDown);
        document.body.style.overflow = 'hidden';
        document.body.appendChild(overlay);
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () { overlay.className = 'psm-overlay psm-visible'; });
        } else {
            setTimeout(function () { overlay.className = 'psm-overlay psm-visible'; }, 16);
        }
        return api;
    }

    /** エラーや案内を narrow の枠に出す（alert は使わない）。閉じたら二重オープン防止を解除する。 */
    function showAdminNotice(titleText, message) {
        var m = openAdminOverlay('narrow', titleText);
        m.afterClose = function () { isAdminOpen = false; };
        m.body.appendChild(adminEl('p', 'psm-error', message));
        var okBtn = adminEl('button', 'psm-btn', '閉じる');
        okBtn.onclick = m.close;
        m.right.appendChild(okBtn);
    }

    /** 全体設定アプリのレコード（先頭1件）を fields 指定なしで取得する。無ければ null。 */
    function fetchGlobalRecord(onSuccess, onError) {
        kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET',
            { app: GLOBAL_SETTINGS_APP_ID, query: 'order by $id asc limit 1' },
            function (resp) {
                var records = (resp && resp.records) ? resp.records : [];
                onSuccess(records.length ? records[0] : null);
            },
            function (err) { onError(err); }
        );
    }

    function fieldValue(record, code) {
        return (record && record[code] && typeof record[code].value === 'string') ? record[code].value : '';
    }

    /** レコードの一部フィールドを revision 指定で更新する（競合は isConflictError で判定）。 */
    function putGlobalRecord(recordId, revision, fieldsObj, onSuccess, onError) {
        kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT',
            { app: GLOBAL_SETTINGS_APP_ID, id: recordId, revision: revision, record: fieldsObj },
            function (resp) { onSuccess(resp); },
            function (err) { onError(err); }
        );
    }

    function formatLocalDateTime(iso) {
        if (!iso) return '―';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        function p2(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }

    /** 管理者設定を開く入口。レコードを取り直し、認証の状態に応じて認証画面か管理者画面へ進む。 */
    function openAdminEntry() {
        if (isAdminOpen) return;
        if (!isGlobalAvailable()) return;
        isAdminOpen = true;
        if (!isCryptoAvailable()) {
            showAdminNotice('管理者設定', 'このブラウザでは管理者設定を利用できません');
            return;
        }
        fetchGlobalRecord(function (record) {
            if (!record) {
                showAdminNotice('管理者設定', '全体設定アプリにレコードがありません。管理者が kintone の画面からレコードを1件作成してください。');
                return;
            }
            checkAdminRights(function (rights) {
                if (!rights || rights.editable !== true) {
                    showAdminNotice('管理者設定', '管理者設定を開く権限がありません。');
                    return;
                }
                if (!record[FIELD_GLOBAL_AUTH]) {
                    showAdminNotice('管理者設定', 'パスワード欄の権限がありません。全体設定アプリのフィールド権限を確認してください。');
                    return;
                }
                var authRaw = fieldValue(record, FIELD_GLOBAL_AUTH);
                if (!authRaw) {
                    if (!rights.authEditable) {
                        showAdminNotice('管理者設定', 'パスワード欄の権限がありません。全体設定アプリのフィールド権限を確認してください。');
                        return;
                    }
                    openPasswordSetupDialog(record);
                    return;
                }
                var auth = parseAuthJson(authRaw);
                if (!auth) {
                    showAdminNotice('管理者設定', '管理者パスワードの設定を読み取れません。全体設定アプリの auth_json を空にして、初回設定をやり直してください。');
                    return;
                }
                // 認証が有効期間内でも、auth_json が空・不正でないことを確かめてから管理者画面を開く
                if (isAuthSessionValid(readAuthSession(), Date.now(), GLOBAL_SETTINGS_APP_ID)) {
                    openAdminPanel(record);
                    return;
                }
                openPasswordLoginDialog(record, auth);
            });
        }, function (err) {
            console.error('portal-navigation: 全体設定レコードの取得に失敗しました。', err);
            showAdminNotice('管理者設定', '全体設定の取得に失敗しました。ネットワーク状況や全体設定アプリの権限をご確認ください。');
        });
    }

    /** パスワード入力欄を1つ作って body に追加する。 */
    function addPasswordField(parent, label) {
        var f = adminEl('div', 'psm-field');
        f.appendChild(adminEl('label', 'psm-field-label', label));
        var input = adminEl('input', 'psm-input');
        input.type = 'password';
        input.setAttribute('autocomplete', 'off');
        f.appendChild(input);
        parent.appendChild(f);
        return input;
    }

    /** 初回のパスワード設定（auth_json が空で、auth_json を編集できる人だけ）。 */
    function openPasswordSetupDialog(record) {
        var m = openAdminOverlay('narrow', '管理者パスワードの初回設定');
        var proceeded = false;
        m.afterClose = function () { if (!proceeded) isAdminOpen = false; };
        m.body.appendChild(adminEl('div', 'pna-lock-icon', '🛡️'));
        m.body.appendChild(adminEl('p', 'pna-lock-text', 'まだ管理者パスワードが設定されていません。全体設定の編集権限がある方だけが設定できます。'));
        var err = adminEl('p', 'psm-error');
        err.style.display = 'none';
        m.body.appendChild(err);
        var p1 = addPasswordField(m.body, '新しいパスワード（' + PASSWORD_MIN_LENGTH + '文字以上）');
        var p2 = addPasswordField(m.body, '確認のためもう一度');
        setTimeout(function () { p1.focus(); }, 220);

        var cancel = adminEl('button', 'psm-btn', 'キャンセル');
        cancel.onclick = m.close;
        var ok = adminEl('button', 'psm-btn psm-btn-dark', '設定して開く');
        m.right.appendChild(cancel);
        m.right.appendChild(ok);

        function showErr(t) { err.textContent = t; err.style.display = 'block'; }
        function submit() {
            if (ok.disabled) return;
            if (p1.value.length < PASSWORD_MIN_LENGTH) { showErr(PASSWORD_MIN_LENGTH + '文字以上で入力してください。'); return; }
            if (p1.value !== p2.value) { showErr('確認用のパスワードが一致しません。'); return; }
            ok.disabled = true;
            ok.textContent = '確認中...';
            function restore() { ok.disabled = false; ok.textContent = '設定して開く'; }
            createAuthRecord(p1.value, getUserDisplayName()).then(function (authObj) {
                var fieldsObj = {};
                fieldsObj[FIELD_GLOBAL_AUTH] = { value: JSON.stringify(authObj) };
                putGlobalRecord(record.$id.value, record.$revision.value, fieldsObj, function (resp) {
                    record.$revision = { value: String(resp.revision) };
                    record[FIELD_GLOBAL_AUTH] = { value: JSON.stringify(authObj) };
                    setAuthSession();
                    proceeded = true;
                    m.close();
                    setTimeout(function () { openAdminPanel(record); }, 120);
                }, function (e) {
                    restore();
                    if (isConflictError(e)) {
                        showErr('他の管理者が先に初回設定を行いました。もう一度開き直してください。');
                    } else {
                        console.error('portal-navigation: パスワードの初回設定に失敗しました。', e);
                        showErr('保存に失敗しました。ネットワーク状況や全体設定アプリの権限をご確認ください。');
                    }
                });
            }, function (e) {
                restore();
                console.error('portal-navigation: パスワードの計算に失敗しました。', e);
                showErr('パスワードの処理に失敗しました。');
            });
        }
        ok.onclick = submit;
        m.body.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    }

    /** パスワードの入力（設定済みのとき）。5回続けて間違えると5分ロックする。 */
    function openPasswordLoginDialog(record, auth) {
        var m = openAdminOverlay('narrow', '管理者認証');
        var proceeded = false;
        m.afterClose = function () { if (!proceeded) isAdminOpen = false; };
        m.body.appendChild(adminEl('div', 'pna-lock-icon', '🔒'));
        m.body.appendChild(adminEl('p', 'pna-lock-text', '全ユーザーの既定値を変更する画面です。管理者パスワードを入力してください。'));
        var err = adminEl('p', 'psm-error');
        err.style.display = 'none';
        m.body.appendChild(err);
        var p1 = addPasswordField(m.body, 'パスワード');
        m.body.appendChild(adminEl('p', 'pna-hint', AUTH_MAX_FAILS + '回続けて間違えると、しばらく入力できなくなります。'));
        setTimeout(function () { p1.focus(); }, 220);

        var cancel = adminEl('button', 'psm-btn', 'キャンセル');
        cancel.onclick = m.close;
        var ok = adminEl('button', 'psm-btn psm-btn-dark', '認証して開く');
        m.right.appendChild(cancel);
        m.right.appendChild(ok);

        function showErr(t) { err.textContent = t; err.style.display = 'block'; }
        function restore() { ok.disabled = false; ok.textContent = '認証して開く'; }
        function submit() {
            if (ok.disabled) return;
            var state = computeLockState(readLock(), Date.now());
            if (state.locked) {
                showErr('入力の失敗が続いたため、あと ' + Math.ceil(state.remainingMs / 1000) + ' 秒お待ちください。');
                return;
            }
            ok.disabled = true;
            ok.textContent = '確認中...';
            verifyPassword(p1.value, auth).then(function (good) {
                restore();
                if (good) {
                    clearFailures();
                    setAuthSession();
                    proceeded = true;
                    m.close();
                    setTimeout(function () { openAdminPanel(record); }, 120);
                    return;
                }
                var lock = registerFailure(readLock(), Date.now());
                writeLock(lock);
                if (lock.until > Date.now()) {
                    showErr(AUTH_MAX_FAILS + '回続けて失敗しました。' + Math.round(AUTH_LOCK_MS / 60000) + '分お待ちください。');
                } else {
                    showErr('パスワードが違います（残り ' + (AUTH_MAX_FAILS - lock.fails) + ' 回）。');
                }
                p1.select();
            }, function (e) {
                restore();
                console.error('portal-navigation: パスワードの確認に失敗しました。', e);
                showErr('パスワードの確認に失敗しました。');
            });
        }
        ok.onclick = submit;
        m.body.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    }

    /** JS既定値から作った全体設定（全体設定がまだ無いときの初期値。初回保存で現行の既定が登録される）。 */
    function makeInitialGlobalSettings() {
        return {
            schemaVersion: GLOBAL_SCHEMA_VERSION,
            settingsRev: 0,
            shortcuts: defaultShortcutList(),
            design: withDerivedHome(DEFAULT_DESIGN),
            shortcutsForceRev: 0,
            designForceRev: 0,
            updatedBy: '',
            updatedAt: ''
        };
    }

    function copyShortcutItem(it) {
        return { type: it.type, targetId: it.targetId, targetName: it.targetName, label: it.label, labelCustom: !!it.labelCustom };
    }

    function makeAdminDraft(settings) {
        var src = settings.shortcuts || defaultShortcutList();
        return {
            shortcuts: src.map(copyShortcutItem),
            design: withDerivedHome(settings.design),
            forceShortcuts: false,
            forceDesign: false
        };
    }

    /** 管理者画面本体。record は fields 指定なしで取得した全体設定レコード。 */
    function openAdminPanel(record) {
        var recordId = String(record.$id.value);
        var baseRecordRevision = String(record.$revision.value);
        var auth = parseAuthJson(fieldValue(record, FIELD_GLOBAL_AUTH));
        var prev = parseGlobalSettingsJson(fieldValue(record, FIELD_GLOBAL_SETTINGS)) || makeInitialGlobalSettings();
        var draft = makeAdminDraft(prev);
        var dirty = { sc: false, ds: false, force: false };
        var activeTab = 'sc';
        var banner = null; // {kind:'ok'|'err', text, reload:Function|null}
        var latestRecord = null;
        var busy = false;
        var loadedApps = [];
        var loadedSpaces = [];
        var candidatesLoading = true;
        var spaceAdd = { value: '', msg: '', ok: true, busy: false };
        var panelClosed = false;
        var spaceAddInputEl = null; // 「スペース追加」入力欄（再描画後のフォーカス復帰用）

        var m = openAdminOverlay('wide', '管理者設定', '全ユーザーの既定値');
        m.afterClose = function () { panelClosed = true; isAdminOpen = false; };
        var tabs = adminEl('div', 'pna-tabs');
        m.dialog.insertBefore(tabs, m.body);

        var TAB_DEFS = [['sc', 'ショートカット既定'], ['ds', 'デザイン既定'], ['force', '反映方法'], ['pw', 'パスワード']];

        function isDirty() { return dirty.sc || dirty.ds || dirty.force; }
        function updateSaveState() {
            saveBtn.disabled = busy || !isDirty();
            saveBtn.style.display = (activeTab === 'pw') ? 'none' : '';
        }
        function renderTabs() {
            removeAllChildren(tabs);
            TAB_DEFS.forEach(function (d) {
                var b = adminEl('button', 'pna-tab' + (activeTab === d[0] ? ' active' : ''), d[1]);
                if (dirty[d[0]]) b.appendChild(adminEl('span', 'dot'));
                b.onclick = function () { activeTab = d[0]; renderTabs(); renderBody(); };
                tabs.appendChild(b);
            });
        }
        function mark(key) {
            dirty[key] = true;
            if (banner && banner.kind === 'ok') banner = null;
            renderTabs();
            updateSaveState();
        }

        function findTargetName(type, targetId) {
            var list = (type === TARGET_TYPE_SPACE) ? loadedSpaces : loadedApps;
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === targetId) return list[i].name;
            }
            return null;
        }

        function themeOfDraft(key) { return THEMES[themeIndexByName(draft.design[key])]; }

        function renderBody() {
            removeAllChildren(m.body);
            if (banner) {
                var bn = adminEl('div', 'pna-banner ' + banner.kind);
                bn.appendChild(adminEl('span', '', banner.text));
                if (banner.reload) {
                    var rb = adminEl('button', 'psm-btn', '最新を読み込む');
                    rb.onclick = banner.reload;
                    bn.appendChild(rb);
                }
                m.body.appendChild(bn);
            }
            var meta = adminEl('div', 'pna-meta');
            meta.appendChild(adminEl('span', '', '改訂番号: ' + prev.settingsRev));
            meta.appendChild(adminEl('span', '', '最終更新: ' + (prev.updatedBy ? (prev.updatedBy + '　' + formatLocalDateTime(prev.updatedAt)) : '（未保存）')));
            meta.appendChild(adminEl('span', '', '認証の有効期限: ' + Math.round(AUTH_SESSION_MS / 60000) + '分'));
            m.body.appendChild(meta);
            if (activeTab === 'sc') renderShortcutTab();
            else if (activeTab === 'ds') renderDesignTab();
            else if (activeTab === 'force') renderForceTab();
            else renderPasswordTab();
            updateSaveState();
        }

        // --- タブ: ショートカット既定 ---
        function fillScPreview(box) {
            removeAllChildren(box);
            var t = themeOfDraft('scTheme');
            var s = SHAPES[shapeIndexByName(draft.design.scShape)];
            draft.shortcuts.forEach(function (it) {
                var text = it.label || it.targetName || '（未設定）';
                var b = adminEl('div', 'psm-preview-btn', (it.type === TARGET_TYPE_SPACE ? '📁 ' : '') + text);
                applyPreviewBtn(b, t, s);
                box.appendChild(b);
            });
        }

        function buildTargetSelect(it) {
            var sel = adminEl('select', 'psm-select');
            var ph = adminEl('option', '', candidatesLoading ? '読み込み中...' : '遷移先を選択してください');
            ph.value = '';
            sel.appendChild(ph);
            var curVal = it.targetId ? (it.type + ':' + it.targetId) : '';
            var found = false;
            if (!candidatesLoading) {
                var g1 = document.createElement('optgroup');
                g1.label = 'アプリ';
                loadedApps.forEach(function (a) {
                    var o = adminEl('option', '', a.name);
                    o.value = TARGET_TYPE_APP + ':' + a.id;
                    if (o.value === curVal) found = true;
                    g1.appendChild(o);
                });
                sel.appendChild(g1);
                if (loadedSpaces.length) {
                    var g2 = document.createElement('optgroup');
                    g2.label = 'スペース';
                    loadedSpaces.forEach(function (sp) {
                        var o = adminEl('option', '', '📁 ' + sp.name);
                        o.value = TARGET_TYPE_SPACE + ':' + sp.id;
                        if (o.value === curVal) found = true;
                        g2.appendChild(o);
                    });
                    sel.appendChild(g2);
                }
            }
            if (curVal && !found) {
                // 候補一覧に無い既存の遷移先も、選択肢として残す（勝手に別の値へ変わらないように）
                var suffix = (it.type === TARGET_TYPE_SPACE) ? '（不明なスペース）' : '（不明なアプリ）';
                var unk = adminEl('option', '', candidatesLoading ? (it.targetName || '読み込み中...') : ((it.targetName || '') + suffix));
                unk.value = curVal;
                sel.insertBefore(unk, sel.children ? sel.children[1] || null : null);
            }
            sel.value = curVal;
            return sel;
        }

        function renderShortcutTab() {
            m.body.appendChild(adminEl('p', 'psm-intro', '個人設定をしていない利用者のポータルに表示されるショートカットです（' + MIN_SHORTCUTS + '〜' + MAX_SHORTCUTS + '個）。'));
            var pv = adminEl('div', 'pna-card');
            pv.appendChild(adminEl('h3', '', '完成イメージ'));
            var box = adminEl('div', 'psm-preview-box');
            fillScPreview(box);
            pv.appendChild(box);
            m.body.appendChild(pv);

            draft.shortcuts.forEach(function (it, i) {
                var row = adminEl('div', 'pna-row');
                row.appendChild(adminEl('span', 'pna-num', String(i + 1)));
                var main = adminEl('div', 'pna-main');

                var f1 = adminEl('div', 'psm-field');
                f1.appendChild(adminEl('label', 'psm-field-label', '登録する遷移先'));
                var sel = buildTargetSelect(it);
                sel.onchange = function () {
                    var idx = sel.value.indexOf(':');
                    if (idx < 1) {
                        it.type = TARGET_TYPE_APP; it.targetId = ''; it.targetName = '';
                    } else {
                        var type = sel.value.slice(0, idx);
                        var targetId = sel.value.slice(idx + 1);
                        var name = findTargetName(type, targetId) || it.targetName || '';
                        it.type = type; it.targetId = targetId; it.targetName = name;
                        if (!it.labelCustom || !it.label) { it.label = name; it.labelCustom = false; }
                    }
                    mark('sc');
                    renderBody();
                };
                f1.appendChild(sel);

                var f2 = adminEl('div', 'psm-field');
                f2.appendChild(adminEl('label', 'psm-field-label', 'ボタンに表示する名前'));
                var inp = adminEl('input', 'psm-input');
                inp.type = 'text';
                inp.value = it.label || '';
                inp.oninput = function () {
                    it.label = inp.value;
                    it.labelCustom = true; // 手入力したら独自の表示名として扱う
                    mark('sc');
                    fillScPreview(box);
                };
                f2.appendChild(inp);
                main.appendChild(f1);
                main.appendChild(f2);
                row.appendChild(main);

                var acts = adminEl('div', 'pna-acts');
                var up = adminEl('button', 'pna-icon-btn', '▲');
                up.title = '上へ移動';
                up.disabled = (i === 0);
                up.onclick = function () { var x = draft.shortcuts.splice(i, 1)[0]; draft.shortcuts.splice(i - 1, 0, x); mark('sc'); renderBody(); };
                var dn = adminEl('button', 'pna-icon-btn', '▼');
                dn.title = '下へ移動';
                dn.disabled = (i === draft.shortcuts.length - 1);
                dn.onclick = function () { var x = draft.shortcuts.splice(i, 1)[0]; draft.shortcuts.splice(i + 1, 0, x); mark('sc'); renderBody(); };
                var del = adminEl('button', 'pna-icon-btn', '✕');
                del.disabled = (draft.shortcuts.length <= MIN_SHORTCUTS);
                del.title = del.disabled ? ('これ以上減らせません（最少' + MIN_SHORTCUTS + '個）') : '削除';
                del.onclick = function () {
                    if (draft.shortcuts.length <= MIN_SHORTCUTS) return;
                    draft.shortcuts.splice(i, 1);
                    mark('sc');
                    renderBody();
                };
                acts.appendChild(up);
                acts.appendChild(dn);
                acts.appendChild(del);
                row.appendChild(acts);
                m.body.appendChild(row);
            });

            var add = adminEl('button', 'psm-btn', '＋ 追加');
            add.disabled = (draft.shortcuts.length >= MAX_SHORTCUTS);
            add.onclick = function () {
                if (draft.shortcuts.length >= MAX_SHORTCUTS) return;
                // 追加した行は遷移先が未選択の状態にする（保存時に検証する）
                draft.shortcuts.push({ type: TARGET_TYPE_APP, targetId: '', targetName: '', label: '', labelCustom: false });
                mark('sc');
                renderBody();
            };
            m.body.appendChild(add);

            if (!candidatesLoading) {
                var spCard = adminEl('div', 'pna-card psm-space-add');
                spCard.appendChild(adminEl('h3', '', '一覧に無いスペースを追加'));
                spCard.appendChild(adminEl('p', 'psm-space-add-note', 'アプリが1つも無いスペースは一覧に出ません。スペースのURL または スペースID を貼り付けて追加してください。'));
                var spRow = adminEl('div', 'psm-space-add-row');
                var spInput = adminEl('input', 'psm-input');
                spInput.type = 'text';
                spInput.placeholder = 'スペースのURL または スペースID';
                spInput.value = spaceAdd.value;
                spaceAddInputEl = spInput;
                // 入力中は値を保持するだけ（再描画・mark しない）
                spInput.oninput = function () { spaceAdd.value = spInput.value; };
                spInput.onkeydown = function (ev) {
                    if (ev.key === 'Enter') { ev.preventDefault(); doAddSpace(); }
                };
                var spBtn = adminEl('button', 'psm-btn', spaceAdd.busy ? '確認中...' : '候補に追加');
                spBtn.disabled = spaceAdd.busy;
                spBtn.onclick = function () { doAddSpace(); };
                spRow.appendChild(spInput);
                spRow.appendChild(spBtn);
                spCard.appendChild(spRow);
                var spMsg = adminEl('p', 'psm-space-add-msg', spaceAdd.msg);
                spMsg.style.color = spaceAdd.ok ? '#2d7a4f' : '#c0392b';
                spCard.appendChild(spMsg);
                m.body.appendChild(spCard);
            }
        }

        // 「一覧に無いスペースを追加」の処理。追加しただけでは行を自動で選ばない
        function doAddSpace() {
            if (spaceAdd.busy) return;
            var id = extractSpaceIdFromInput(spaceAdd.value);
            if (id === null) {
                spaceAdd.ok = false;
                spaceAdd.msg = 'スペースのURLまたはIDを正しく入力してください。';
                renderBody();
                return;
            }
            for (var i = 0; i < loadedSpaces.length; i++) {
                if (String(loadedSpaces[i].id) === id) {
                    spaceAdd.ok = true;
                    spaceAdd.msg = 'このスペースは既に一覧にあります。';
                    renderBody();
                    return;
                }
            }
            spaceAdd.busy = true;
            renderBody();
            fetchSpaceById(id, function (space) {
                if (panelClosed) return;
                addSpaceCandidate(loadedSpaces, space);
                if (spaceListCache) spaceListCache = loadedSpaces;
                spaceAdd.ok = true;
                spaceAdd.msg = '『' + space.name + '』を候補に追加しました。';
                spaceAdd.value = '';
                spaceAdd.busy = false;
                if (activeTab === 'sc') { spaceAddInputEl = null; renderBody(); if (spaceAddInputEl) spaceAddInputEl.focus(); }
            }, function () {
                if (panelClosed) return;
                spaceAdd.ok = false;
                spaceAdd.msg = 'スペースが見つからないか、閲覧権限がありません。';
                spaceAdd.busy = false;
                if (activeTab === 'sc') { spaceAddInputEl = null; renderBody(); if (spaceAddInputEl) spaceAddInputEl.focus(); }
            });
        }

        // --- タブ: デザイン既定 ---
        function renderDesignTab() {
            m.body.appendChild(adminEl('p', 'psm-intro', '個人設定をしていない利用者に適用される見た目です。利用者は 🎨 で自分用に変更できます（ホームボタンはショートカットと同じ色・形になります。全員に揃えたい場合は「反映方法」タブへ）。'));
            var grid = adminEl('div', 'pna-design-grid');

            var c1 = adminEl('div', 'pna-card');
            c1.appendChild(adminEl('h3', '', 'ショートカットボタン'));
            c1.appendChild(fieldLabel('色'));
            c1.appendChild(swatchGroup(draft.design.scTheme, 'grad', function (n) { draft.design.scTheme = n; mark('ds'); renderBody(); }));
            c1.appendChild(fieldLabel('形', true));
            c1.appendChild(segGroup(SHAPES, draft.design.scShape, function (n) { draft.design.scShape = n; mark('ds'); renderBody(); }));
            c1.appendChild(fieldLabel('プレビュー', true));
            c1.appendChild(buildShortcutPreview(
                draft.shortcuts.map(function (it) { return it.label || it.targetName || '（未設定）'; }),
                themeOfDraft('scTheme'),
                SHAPES[shapeIndexByName(draft.design.scShape)]
            ));

            var c2 = adminEl('div', 'pna-card');
            c2.appendChild(adminEl('h3', '', 'ホームボタン（モバイル）'));
            c2.appendChild(adminEl('p', 'pna-hint', 'ショートカットボタンと同じ色・形になります（カプセル→丸、角丸→角丸）。'));
            c2.appendChild(fieldLabel('プレビュー', true));
            c2.appendChild(buildHomePreview(themeOfDraft('scTheme'), homeShapeNameForScShape(draft.design.scShape)));

            grid.appendChild(c1);
            grid.appendChild(c2);
            m.body.appendChild(grid);
            m.body.appendChild(adminEl('p', 'pna-hint', 'ホームボタンの遷移先（ポータル）と表示する画面は固定のため、ここでは変更できません。'));
        }

        // --- タブ: 反映方法 ---
        function renderForceTab() {
            m.body.appendChild(adminEl('p', 'psm-intro', '通常は、利用者が自分で変えた設定（個人設定）が優先されます。全員に揃えたいときだけチェックしてください。'));
            var card = adminEl('div', 'pna-card');
            [['forceShortcuts', 'ショートカットの並びを全員に強制反映', '保存時点より前の個人設定（遷移先・表示名・並び順）を無効にし、全員にこの既定値を表示します。'],
             ['forceDesign', 'デザイン（色・形。ホームボタンも連動）を全員に強制反映', '保存時点より前の 🎨 の個人設定（色・形）を無効にします。']].forEach(function (d) {
                var item = adminEl('label', 'pna-force-item');
                var cb = adminEl('input');
                cb.type = 'checkbox';
                cb.checked = draft[d[0]];
                cb.onchange = function () {
                    draft[d[0]] = cb.checked;
                    dirty.force = draft.forceShortcuts || draft.forceDesign;
                    renderTabs();
                    updateSaveState();
                };
                var tx = adminEl('div');
                tx.appendChild(adminEl('div', 't', d[1]));
                tx.appendChild(adminEl('div', 'd', d[2]));
                item.appendChild(cb);
                item.appendChild(tx);
                card.appendChild(item);
            });
            m.body.appendChild(card);
            m.body.appendChild(adminEl('div', 'pna-warn', '⚠️ 強制反映は取り消せません。無効になった個人設定は、利用者が再度設定し直す必要があります。強制反映のあとに利用者が変えた設定は、通常どおり優先されます。'));
        }

        // --- タブ: パスワード ---
        function renderPasswordTab() {
            m.body.appendChild(adminEl('p', 'psm-intro', '管理者全員で共通のパスワードです。管理者から外れた方は、全体設定アプリの権限から外すだけで入れなくなります。'));
            m.body.appendChild(adminEl('p', 'pna-hint', '※ このパスワードは画面の入口を守る補助です。本当の防御は全体設定アプリの権限設定です。'));
            var card = adminEl('div', 'pna-card');
            var msg = adminEl('p', '');
            card.appendChild(msg);
            var cur = addPasswordField(card, '現在のパスワード');
            var n1 = addPasswordField(card, '新しいパスワード（' + PASSWORD_MIN_LENGTH + '文字以上）');
            var n2 = addPasswordField(card, '確認のためもう一度');
            var btn = adminEl('button', 'psm-btn psm-btn-dark', 'パスワードを変更');
            function fail(t) { msg.className = 'psm-error'; msg.textContent = t; }
            btn.onclick = function () {
                if (busy) return;
                if (!auth) { fail('現在のパスワードを確認できません。いったん閉じて開き直してください。'); return; }
                busy = true;
                btn.disabled = true;
                function done() { busy = false; btn.disabled = false; }
                verifyPassword(cur.value, auth).then(function (good) {
                    if (!good) { done(); fail('現在のパスワードが違います。'); return; }
                    if (n1.value.length < PASSWORD_MIN_LENGTH) { done(); fail(PASSWORD_MIN_LENGTH + '文字以上で入力してください。'); return; }
                    if (n1.value !== n2.value) { done(); fail('確認用のパスワードが一致しません。'); return; }
                    return createAuthRecord(n1.value, getUserDisplayName()).then(function (newAuth) {
                        var fieldsObj = {};
                        fieldsObj[FIELD_GLOBAL_AUTH] = { value: JSON.stringify(newAuth) };
                        putGlobalRecord(recordId, baseRecordRevision, fieldsObj, function (resp) {
                            done();
                            baseRecordRevision = String(resp.revision);
                            auth = parseAuthJson(JSON.stringify(newAuth));
                            msg.className = 'psm-ok';
                            msg.textContent = 'パスワードを変更しました（この保存はパスワードだけで、ほかのタブの変更は含みません）。';
                            cur.value = ''; n1.value = ''; n2.value = '';
                        }, function (e) {
                            done();
                            if (isConflictError(e)) { handleConflict(); return; }
                            console.error('portal-navigation: パスワードの変更に失敗しました。', e);
                            fail('保存に失敗しました。ネットワーク状況や全体設定アプリの権限をご確認ください。');
                        });
                    });
                }).then(null, function (e) {
                    done();
                    console.error('portal-navigation: パスワードの処理に失敗しました。', e);
                    fail('パスワードの処理に失敗しました。');
                });
            };
            card.appendChild(btn);
            m.body.appendChild(card);
        }

        // --- 競合（他の管理者が先に保存した） ---
        function resetFromRecord(rec) {
            record = rec;
            recordId = String(rec.$id.value);
            baseRecordRevision = String(rec.$revision.value);
            auth = parseAuthJson(fieldValue(rec, FIELD_GLOBAL_AUTH)) || auth;
            prev = parseGlobalSettingsJson(fieldValue(rec, FIELD_GLOBAL_SETTINGS)) || makeInitialGlobalSettings();
            draft = makeAdminDraft(prev);
            dirty = { sc: false, ds: false, force: false };
        }

        function handleConflict() {
            kintone.api(kintone.api.url('/k/v1/record.json', true), 'GET', { app: GLOBAL_SETTINGS_APP_ID, id: recordId },
                function (resp) {
                    latestRecord = resp && resp.record ? resp.record : null;
                    var latest = latestRecord ? parseGlobalSettingsJson(fieldValue(latestRecord, FIELD_GLOBAL_SETTINGS)) : null;
                    showConflict(latest && latest.updatedBy ? latest.updatedBy : '不明');
                },
                function () { latestRecord = null; showConflict('不明'); }
            );
        }
        function showConflict(who) {
            banner = {
                kind: 'err',
                text: '⚠️ 他の管理者（' + who + '）が先に保存したため、保存できませんでした。最新の内容を読み込んでから、もう一度編集してください。',
                reload: function () {
                    function apply(rec) {
                        resetFromRecord(rec);
                        banner = null;
                        renderTabs();
                        renderBody();
                    }
                    if (latestRecord) { apply(latestRecord); return; }
                    fetchGlobalRecord(function (rec) { if (rec) apply(rec); }, function (e) { console.error('portal-navigation: 最新の取得に失敗しました。', e); });
                }
            };
            renderTabs();
            renderBody();
        }

        // --- フッター ---
        var lockBtn = adminEl('button', 'psm-btn', '🔒 ロックして閉じる');
        lockBtn.title = '認証状態を解除して閉じます';
        lockBtn.onclick = function () { clearAuthSession(); tryClose(); };
        m.left.appendChild(lockBtn);
        var cancel = adminEl('button', 'psm-btn', 'キャンセル');
        cancel.onclick = function () { m.close(); };
        var saveBtn = adminEl('button', 'psm-btn psm-btn-dark', '保存して全体に反映');
        m.right.appendChild(cancel);
        m.right.appendChild(saveBtn);

        function tryClose() {
            if (isDirty() && !window.confirm('編集中の内容が保存されていません。破棄してよろしいですか？')) return;
            m.close();
        }
        m.onClose = tryClose;

        // --- 確認ダイアログ ---
        saveBtn.onclick = function () { openConfirm(); };

        function openConfirm() {
            var c = openAdminOverlay('narrow', '保存の確認');
            c.body.appendChild(adminEl('p', 'psm-intro', '次の内容で全体設定を更新します。'));
            var ul = adminEl('ul', 'pna-confirm-list');
            if (dirty.sc) ul.appendChild(adminEl('li', '', 'ショートカット既定を変更（' + draft.shortcuts.length + '個）'));
            if (dirty.ds) ul.appendChild(adminEl('li', '', 'デザイン既定を変更'));
            ul.appendChild(adminEl('li', '', draft.forceShortcuts ? 'ショートカット: 全員に強制反映する' : 'ショートカット: 個人設定を優先'));
            ul.appendChild(adminEl('li', '', draft.forceDesign ? 'デザイン: 全員に強制反映する' : 'デザイン: 個人設定を優先'));
            c.body.appendChild(ul);
            c.body.appendChild(adminEl('p', 'pna-hint', '他の利用者の画面には、最長' + Math.round(GLOBAL_CACHE_TTL_MS / 60000) + '分以内（キャッシュの有効期限）に反映されます。'));
            var back = adminEl('button', 'psm-btn', '戻る');
            back.onclick = c.close;
            var go = adminEl('button', 'psm-btn psm-btn-dark', '保存する');
            go.onclick = function () { c.close(); doSave(); };
            c.right.appendChild(back);
            c.right.appendChild(go);
        }

        // --- 保存 ---
        function doSave() {
            if (busy) return;
            try {
                validateShortcutList(draft.shortcuts);
            } catch (e) {
                banner = { kind: 'err', text: (e && e.message) ? e.message : '入力内容を確認してください。', reload: null };
                activeTab = 'sc';
                renderTabs();
                renderBody();
                return;
            }
            var nextRev = prev.settingsRev + 1;
            var payload = buildGlobalSettingsPayload(draft, nextRev, draft.forceShortcuts, draft.forceDesign, prev);
            var json = JSON.stringify(payload);
            var fieldsObj = {};
            fieldsObj[FIELD_GLOBAL_SETTINGS] = { value: json };
            busy = true;
            updateSaveState();
            putGlobalRecord(recordId, baseRecordRevision, fieldsObj, function (resp) {
                busy = false;
                baseRecordRevision = String(resp.revision);
                prev = parseGlobalSettingsJson(json) || payload;
                draft = makeAdminDraft(prev);
                dirty = { sc: false, ds: false, force: false };
                writeGlobalCache({
                    appId: String(GLOBAL_SETTINGS_APP_ID),
                    recordId: recordId,
                    recordRevision: baseRecordRevision,
                    fetchedAt: Date.now(),
                    settingsRaw: json
                });
                banner = { kind: 'ok', text: '✅ 全体設定を保存しました（改訂番号 ' + nextRev + '）。', reload: null };
                renderTabs();
                renderBody();
                try {
                    window.PortalNavigation._onGlobalChanged();
                } catch (e) {
                    console.error('portal-navigation: 保存後の再描画に失敗しました。', e);
                }
            }, function (err) {
                busy = false;
                if (isConflictError(err)) {
                    handleConflict();
                    return;
                }
                console.error('portal-navigation: 全体設定の保存に失敗しました。', err);
                banner = { kind: 'err', text: '保存に失敗しました。ネットワーク状況や全体設定アプリの権限をご確認ください。', reload: null };
                renderTabs();
                renderBody();
            });
        }

        // --- 候補（アプリ・スペース）の取得。取得が終わったら描き直す ---
        function candidatesDone() {
            candidatesLoading = false;
            if (activeTab === 'sc') renderBody();
        }
        fetchAllApps(function (apps) {
            loadedApps = apps;
            fetchAllSpaces(function (spaces) {
                loadedSpaces = spaces;
                // アプリを持たないスペースも、既定のショートカットから名前を解決する
                resolveMissingSpaceCandidates(loadedSpaces, draft.shortcuts, candidatesDone);
            });
        }, function (err) {
            console.error('portal-navigation: アプリ一覧の取得に失敗しました。', err);
            candidatesDone();
        });

        renderTabs();
        renderBody();
    }


    // ============================================================
    // 11. ショートカット機能の描画（ポータル）
    // ============================================================
    kintone.events.on(PORTAL_EVENTS, function (event) {
        var isMobile = (event.type === 'mobile.portal.show');
        // 画面再表示でも遷移中表示を残さない（二重描画防止の早期returnより前で行う）
        resetTapStates();
        injectTapStyle();

        var portalSpace = isMobile
            ? kintone.mobile.portal.getContentSpaceElement()
            : kintone.portal.getContentSpaceElement();

        var container = PortalCustomize.init(isMobile, portalSpace);
        if (!container) return event;

        // 二重描画防止（このファイル分のマーカー。ショートカット再描画時もこのマーカー自体は変更しない）
        if (container.getAttribute('data-shortcut-rendered') === 'true') {
            // 統合ファイルの印が無ければ、旧 portal-shortcut.js が先に描画している
            if (container.getAttribute(NAV_MARKER_ATTR) !== 'true') {
                console.warn('portal-navigation: 旧 portal-shortcut.js と同時に登録されています。旧ファイルの登録を外してください。');
            }
            return event;
        }
        container.setAttribute('data-shortcut-rendered', 'true');
        container.setAttribute(NAV_MARKER_ATTR, 'true');

        // --- アプリボタン生成（スロット1） ---
        var createdButtons = [];

        function clearShortcutButtons() {
            var olds = container.querySelectorAll('[' + BTN_MARKER_ATTR + '="true"]');
            for (var i = 0; i < olds.length; i++) {
                if (olds[i].parentNode) olds[i].parentNode.removeChild(olds[i]);
            }
        }

        /**
         * ショートカット項目の遷移先URLを組み立てる。
         * アプリ: /k/{id}/ 。スペース: PC /k/#/space/{id} 、モバイル /k/m/space/{id}（ハッシュ無し）。
         * （本番用フォルダ/スペース設定/space-visibility-filter.js:161 および
         *  space-join-button.js:112 の実機確認済みコメントと一致する形式）
         */
        function buildShortcutHref(item) {
            if (item.type === TARGET_TYPE_SPACE) {
                return isMobile ? ('/k/m/space/' + item.targetId) : ('/k/#/space/' + item.targetId);
            }
            return '/k/' + item.targetId + '/';
        }

        /** 設定配列からショートカットボタンを描画し直す（保存直後もリロードなしで呼べる） */
        function redrawShortcuts() {
            var list = loadShortcutSettings();
            clearShortcutButtons();
            createdButtons.length = 0;

            list.forEach(function (item) {
                var linkBtn = document.createElement('a');
                linkBtn.setAttribute(BTN_MARKER_ATTR, 'true');
                linkBtn.href = buildShortcutHref(item);
                var linkLabel = document.createElement('span');
                linkLabel.textContent = item.label || item.targetName || item.targetId;
                linkBtn.appendChild(linkLabel);
                if (item.type === TARGET_TYPE_SPACE) {
                    // PC側はハッシュのみの変化だと portal.show イベントが発火せず遷移しないことがあるため、
                    // クリック時に明示的に location.href へ代入する（通常のページ遷移として扱わせる）。
                    // 同一URL（既にそのスペースを開いている状態）の場合はリロードする。
                    linkBtn.onclick = function (e) {
                        // ctrl/cmd/shift/alt 付きはブラウザ標準動作（新規タブ等）に任せる
                        if (!isPlainActivation(e)) return;
                        e.preventDefault();
                        var href = buildShortcutHref(item);
                        if (location.pathname + location.hash === href) {
                            location.reload();
                            return;
                        }
                        location.href = href;
                    };
                }
                linkBtn.style.boxSizing = 'border-box';
                linkBtn.style.display = 'flex';
                linkBtn.style.justifyContent = 'center';
                linkBtn.style.alignItems = 'center';
                linkBtn.style.color = '#fff';
                linkBtn.style.border = 'none';
                linkBtn.style.textDecoration = 'none';
                linkBtn.style.fontWeight = 'bold';
                linkBtn.style.letterSpacing = '0.5px';
                linkBtn.style.textAlign = 'center';
                linkBtn.style.lineHeight = '1.3';
                linkBtn.style.textShadow = '0 1px 2px rgba(0,0,0,0.2)';
                if (isMobile) {
                    linkBtn.style.width = 'calc(50% - 5px)';
                    linkBtn.style.padding = '10px 5px';
                    linkBtn.style.fontSize = '13px';
                    linkBtn.style.minHeight = '48px';
                } else {
                    linkBtn.style.width = '180px';
                    linkBtn.style.padding = '14px 10px';
                    linkBtn.style.fontSize = '14px';
                }
                // タップ演出（リップル＋遷移中の進捗バー）。ホバーはCSS側のメディアクエリで行う
                linkBtn.className = 'pst-tap pst-tap-link';
                attachTapFeedback(linkBtn, true, 'pst');
                createdButtons.push(linkBtn);
                PortalCustomize.addShortcutItem(linkBtn);
            });

            updateStyles();
        }

        // --- 色/形ボタン（スロット2） ---
        function createConfigBtn(icon, title) {
            var btn = document.createElement('button');
            var iconSpan = document.createElement('span');
            iconSpan.textContent = icon;
            btn.appendChild(iconSpan);
            btn.title = title;
            btn.style.border = '1px solid #ddd';
            btn.style.borderRadius = '50%';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '14px';
            btn.style.width = '32px';
            btn.style.height = '32px';
            btn.style.display = 'flex';
            btn.style.justifyContent = 'center';
            btn.style.alignItems = 'center';
            btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
            // 背景色・ホバーはCSS側（#portal-customize-config .pst-tap-config）で指定。遷移しないのでバーは出さない
            btn.className = 'pst-tap pst-tap-config';
            attachTapFeedback(btn, false, 'pst');
            return btn;
        }

        function updateStyles() {
            // 毎回、個人設定 → 全体設定 → JS既定 の優先順位で解決する
            var design = currentDesign();
            var theme = THEMES[themeIndexByName(design.scTheme)];
            var shape = SHAPES[shapeIndexByName(design.scShape)];
            createdButtons.forEach(function (btn) {
                btn.style.background = theme.grad;
                btn.style.boxShadow = theme.shadow;
                btn.style.borderRadius = shape.radius;
                btn.style.setProperty('--pst-base', theme.base); // フォーカス枠の色
            });
            // 🎨⚙️ のフォーカス枠色もテーマに合わせる（コンテナ経由で継承）
            var configEl = document.getElementById(CONFIG_ID);
            if (configEl) {
                configEl.style.setProperty('--pst-base', theme.base);
            }
        }

        redrawShortcuts();
        // キャッシュから即描画した直後、非同期でリモート設定と同期する（共有モード＋同期有効時のみ）。
        // ポータルの初期描画はブロックしない。
        syncFromRemote(redrawShortcuts);
        // 全体設定（管理者の既定値）も同様に、キャッシュで即描画したあと非同期で取り直す。
        // redrawShortcuts の中で updateStyles も呼ばれる。
        refreshGlobalSettings(false, function () {
            redrawShortcuts();
            applyHomeDesignToExisting();
        });
        // 管理者画面で保存した直後に、ポータルのショートカット・スタイル・ホームボタンを描き直す
        window.PortalNavigation._onGlobalChanged = function () {
            redrawShortcuts();
            applyHomeDesignToExisting();
        };

        var designBtn = createConfigBtn('🎨', '色・形を変更');
        designBtn.onclick = function () {
            openDesignSettingsModal(function () {
                updateStyles();
                applyHomeDesignToExisting();
            });
        };

        var settingsBtn = createConfigBtn('⚙️', 'ショートカットを編集');
        settingsBtn.onclick = function () {
            openShortcutSettingsModal(redrawShortcuts);
        };

        PortalCustomize.addConfigItem(designBtn);
        PortalCustomize.addConfigItem(settingsBtn);

        return event;
    });

    // ============================================================
    // 12. 公開（window.PortalNavigation）とホームボタンの登録
    // ============================================================
    window.PortalNavigation = {
        loaded: true,
        version: '1.0.0',
        /** 全体設定を強制的に取り直す（キャッシュを無視）。内容が変わっていれば再描画する。 */
        refreshGlobalSettings: function () {
            refreshGlobalSettings(true, function () { window.PortalNavigation._onGlobalChanged(); });
        },
        /** 全体設定が変わったときの再描画。ポータルのハンドラが差し替える（それまではホームボタンだけ）。 */
        _onGlobalChanged: function () { applyHomeDesignToExisting(); },
        // 純関数・準純関数への読み取り専用の参照（テスト用）。DOM には触れない。本番の動作には影響しない
        __test__: {
            extractSpaceIdFromInput: extractSpaceIdFromInput,
            addSpaceCandidate: addSpaceCandidate,
            parseGlobalSettingsJson: parseGlobalSettingsJson,
            buildGlobalSettingsPayload: buildGlobalSettingsPayload,
            parsePersonalPayload: parsePersonalPayload,
            buildSettingsPayload: buildSettingsPayload,
            parseSettingsJson: parseSettingsJson,
            normalizeButtons: normalizeButtons,
            isPersonalValid: isPersonalValid,
            resolveShortcutList: resolveShortcutList,
            resolveDesign: resolveDesign,
            isCacheFresh: isCacheFresh,
            isGlobalAvailable: isGlobalAvailable,
            isSyncAvailable: isSyncAvailable,
            isMobilePath: isMobilePath,
            parseAuthJson: parseAuthJson,
            hashPassword: hashPassword,
            createAuthRecord: createAuthRecord,
            verifyPassword: verifyPassword,
            timingSafeEqual: timingSafeEqual,
            bytesToBase64: bytesToBase64,
            base64ToBytes: base64ToBytes,
            computeLockState: computeLockState,
            registerFailure: registerFailure,
            isAuthSessionValid: isAuthSessionValid,
            isConflictError: isConflictError,
            refreshGlobalSettings: refreshGlobalSettings,
            savePersonalDesign: savePersonalDesign,
            clearPersonalDesign: clearPersonalDesign,
            readPersonalDesign: readPersonalDesign,
            homeShapeNameForScShape: homeShapeNameForScShape,
            buildShortcutPreview: buildShortcutPreview,
            withDerivedHome: withDerivedHome,
            openDesignSettingsModal: openDesignSettingsModal,
            checkAdminRights: checkAdminRights,
            setupHomeButton: setupHomeButton,
            constants: {
                THEMES: THEMES,
                SHAPES: SHAPES,
                HOME_SHAPES: HOME_SHAPES,
                DEFAULT_DESIGN: DEFAULT_DESIGN,
                GLOBAL_CACHE_TTL_MS: GLOBAL_CACHE_TTL_MS,
                PBKDF2_ITERATIONS: PBKDF2_ITERATIONS,
                AUTH_MAX_FAILS: AUTH_MAX_FAILS,
                AUTH_LOCK_MS: AUTH_LOCK_MS
            }
        }
    };

    // ホームボタン: 一覧・詳細・スペースの各画面で表示する
    kintone.events.on(HOME_EVENTS, function (event) {
        setupHomeButton();
        return event;
    });

    // ボタンの無条件マウント（モバイル画面のみ）。
    // Kintoneはモバイルの「スレッド個別表示」等に対応するJSカスタマイズイベントを提供していないため、
    // イベント登録だけではその画面でボタンが一度もマウントされない。setupHomeButton() は重複防止ガードを
    // 持つので、読み込み時に呼んでも二重生成は起きない。統合ファイルは PC にも登録するため、
    // PC の画面には出さないよう isMobilePath でガードする。
    if (isMobilePath(location.pathname)) {
        setupHomeButton();
        refreshGlobalSettings(false, applyHomeDesignToExisting);
    }
})();
