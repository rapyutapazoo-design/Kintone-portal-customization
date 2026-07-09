/**
 * font-size-changer.js
 * Kintone のフォントサイズ変更機能（格納式セグメントUI）。
 *
 * 【設計方針】
 *   - 画面右下に常駐するウィジェット。格納時は「文字」ボタン、クリックで小中大セグメントが展開する。
 *     展開時のレイアウトは [小 中 大]（px併記・スライドインジケータ）＋ 右に「文字」ボタン。
 *   - 対象画面で同一のUI・操作を提供する。
 *   - 開閉状態は localStorage に保存（既定は格納）。スタイルは <style> 注入（重複防止ID付き）。
 *   - ショートカット機能（portal-shortcut.js）や共有コーディネーター window.PortalCustomize には
 *     一切依存しない、完全に自己完結したファイル。
 *
 * 【対象テキスト（Allowlist方式）】
 *   システムUI（ヘッダー・サイドバー等）や、通知カード・スペース一覧・アプリ一覧の標準レイアウトを
 *   崩さないため、お知らせ本文・スレッド本文・レコード値・コメント等の「読むテキスト」エリアのみを
 *   対象に CSS を注入する（generateCustomCss 参照）。
 */
(function () {
    "use strict";

    // --- 共通定数 ---
    var STORAGE_KEY_SIZE = 'kintone-custom-font-size';
    var STORAGE_KEY_COLLAPSED = 'kintone-font-ui-collapsed';
    var STYLE_ID = 'kintone-custom-font-style';      // 本文サイズ用CSS（Allowlist注入）
    var WIDGET_STYLE_ID = 'kintone-font-ui-style';   // ウィジェット見た目用CSS
    var WIDGET_ID = 'kintone-font-ui';

    var SIZES = [
        { label: '小', value: '14px' },
        { label: '中', value: '20px' },
        { label: '大', value: '24px' }
    ];

    // ウィジェットUIを表示する画面（ポータルを含む全画面）
    var FONT_UI_EVENTS = [
        'portal.show', 'mobile.portal.show',
        'app.record.index.show', 'mobile.app.record.index.show',
        'app.record.detail.show', 'mobile.app.record.detail.show',
        // 新規作成・編集画面。モバイルでの純正保存ツールバー衝突回避のため位置補正を発火させる
        'app.record.create.show', 'mobile.app.record.create.show',
        'app.record.edit.show', 'mobile.app.record.edit.show',
        'app.report.show',
        'space.portal.show', 'mobile.space.portal.show'
    ];

    // 基本位置は右下（従来位置）。ただし「モバイルの、ポータル以外の画面」だけは
    // Kintone純正のフローティングボタン（追加/保存等）と衝突するため右上へ回避する。
    // PCでは同様の衝突が確認されていないため、常に右下のまま。
    var PORTAL_EVENTS = ['portal.show', 'mobile.portal.show'];

    // --- メイン処理 ---
    kintone.events.on(FONT_UI_EVENTS, function (event) {
        ensureWidgetStyle();
        setupFontWidget();
        updateWidgetPosition(event);
        return event;
    });

    // 初期化（保存済みサイズを適用）
    var initSize = localStorage.getItem(STORAGE_KEY_SIZE) || '14px';
    applyGlobalFontSize(initSize);

    // ウィジェットの無条件マウント。
    // Kintoneはモバイルの「スレッド個別表示」等に対応するJSカスタマイズイベントを提供して
    // いないため、kintone.events.on(FONT_UI_EVENTS, ...) だけではその画面でウィジェットが
    // 一度もマウントされない。setupFontWidget() は重複防止ガードを持つため、スクリプト読み込み時
    // に無条件で呼んでも他画面での二重生成は起きず、どの画面でも確実にウィジェットを表示できる。
    ensureWidgetStyle();
    setupFontWidget();

    // --- ウィジェット見た目用CSSの注入（1度のみ） ---
    function ensureWidgetStyle() {
        if (document.getElementById(WIDGET_STYLE_ID)) return;
        var st = document.createElement('style');
        st.id = WIDGET_STYLE_ID;
        st.textContent = [
            '#' + WIDGET_ID + '.cseg{position:fixed;right:22px;bottom:22px;z-index:10000;display:flex;align-items:center;gap:0;background:#fff;border:1px solid #e2e8f0;border-radius:9999px;box-shadow:0 6px 20px rgba(21,66,96,.18);padding:6px;transition:gap .25s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Noto Sans JP",Roboto,sans-serif;}',
            '#' + WIDGET_ID + '.cseg.mobile-top{bottom:auto;top:70px;right:16px;}',
            '#' + WIDGET_ID + '.cseg.expanded{gap:8px;}',
            '#' + WIDGET_ID + ' .kfui-body{display:flex;align-items:center;overflow:hidden;transition:width .25s ease,opacity .15s ease;}',
            '#' + WIDGET_ID + '.cseg.collapsed .kfui-body{width:0;opacity:0;}',
            '#' + WIDGET_ID + '.cseg.expanded .kfui-body{width:162px;opacity:1;}',
            '#' + WIDGET_ID + ' .kfui-track{position:relative;display:flex;background:#f0f3f6;border-radius:9999px;padding:3px;}',
            '#' + WIDGET_ID + ' .kfui-ind{position:absolute;top:3px;bottom:3px;width:52px;border-radius:9999px;background:linear-gradient(135deg,#2b7bc0,#154260);box-shadow:0 2px 6px rgba(21,66,96,.35);transition:transform .25s ease;}',
            '#' + WIDGET_ID + ' .kfui-sz{position:relative;z-index:1;width:52px;border:none;background:transparent;cursor:pointer;padding:6px 0;display:flex;flex-direction:column;align-items:center;line-height:1.1;font-weight:700;color:#555;transition:color .15s ease;}',
            '#' + WIDGET_ID + ' .kfui-sz .kfui-big{font-size:14px;}',
            '#' + WIDGET_ID + ' .kfui-sz .kfui-px{font-size:9px;opacity:.7;margin-top:2px;}',
            '#' + WIDGET_ID + ' .kfui-sz.active{color:#fff;}',
            '#' + WIDGET_ID + ' .kfui-sz:focus-visible{outline:2px solid #3498db;outline-offset:2px;border-radius:8px;}',
            '#' + WIDGET_ID + ' .kfui-trigger{border:none;cursor:pointer;border-radius:9999px;padding:9px 16px;background:linear-gradient(135deg,#2b7bc0,#154260);color:#fff;font-weight:700;font-size:14px;white-space:nowrap;box-shadow:0 2px 8px rgba(21,66,96,.35);transition:filter .15s ease;}',
            '#' + WIDGET_ID + ' .kfui-trigger:hover{filter:brightness(1.08);}',
            '#' + WIDGET_ID + ' .kfui-trigger:focus-visible{outline:2px solid #3498db;outline-offset:2px;}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // --- ウィジェットの配置切り替え ---
    // 「モバイル」かつ「ポータル以外」の画面の時だけ 'mobile-top' クラスを付与し、
    // 右上（純正ボタン回避）に配置する。それ以外（PC全般／モバイルのポータル）は
    // 既定の右下（従来位置）のまま。
    function updateWidgetPosition(event) {
        var el = document.getElementById(WIDGET_ID);
        if (!el) return;
        var isMobile = event.type.indexOf('mobile.') === 0;
        var isPortal = PORTAL_EVENTS.indexOf(event.type) !== -1;
        el.classList.toggle('mobile-top', isMobile && !isPortal);
    }

    // --- ウィジェット本体の生成 ---
    function setupFontWidget() {
        if (document.getElementById(WIDGET_ID)) return;

        var collapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED) !== 'false'; // 既定は格納
        var currentSize = localStorage.getItem(STORAGE_KEY_SIZE) || '14px';

        var cseg = document.createElement('div');
        cseg.id = WIDGET_ID;
        cseg.className = 'cseg ' + (collapsed ? 'collapsed' : 'expanded');

        // 展開部（小中大セグメント）
        var body = document.createElement('div');
        body.className = 'kfui-body';
        var track = document.createElement('div');
        track.className = 'kfui-track';
        var ind = document.createElement('div');
        ind.className = 'kfui-ind';
        track.appendChild(ind);

        var szButtons = [];
        function updateActive(active) {
            var idx = 0;
            SIZES.forEach(function (s, i) { if (s.value === active) idx = i; });
            ind.style.transform = 'translateX(' + (idx * 52) + 'px)';
            szButtons.forEach(function (b, i) { b.classList.toggle('active', i === idx); });
        }

        SIZES.forEach(function (s) {
            var b = document.createElement('button');
            b.className = 'kfui-sz';
            b.innerHTML = '<span class="kfui-big">' + s.label + '</span>' +
                          '<span class="kfui-px">' + parseInt(s.value, 10) + 'px</span>';
            b.setAttribute('aria-label', s.label + ' ' + s.value);
            b.onclick = function () {
                currentSize = s.value;
                localStorage.setItem(STORAGE_KEY_SIZE, currentSize);
                applyGlobalFontSize(currentSize);
                updateActive(currentSize);
                document.dispatchEvent(new CustomEvent('kintone-font-size-changed', { detail: currentSize }));
            };
            track.appendChild(b);
            szButtons.push(b);
        });
        body.appendChild(track);

        // トリガー（「文字」ボタン・小中大の右に配置）
        var trigger = document.createElement('button');
        trigger.className = 'kfui-trigger';
        trigger.textContent = '文字';
        trigger.setAttribute('aria-expanded', String(!collapsed));
        trigger.setAttribute('aria-label', collapsed ? '文字サイズ設定を開く' : '文字サイズ設定を閉じる');
        trigger.onclick = function () {
            var willCollapse = cseg.classList.contains('expanded');
            cseg.classList.toggle('collapsed', willCollapse);
            cseg.classList.toggle('expanded', !willCollapse);
            localStorage.setItem(STORAGE_KEY_COLLAPSED, String(willCollapse));
            trigger.setAttribute('aria-expanded', String(!willCollapse));
            trigger.setAttribute('aria-label', willCollapse ? '文字サイズ設定を開く' : '文字サイズ設定を閉じる');
        };

        cseg.appendChild(body);
        cseg.appendChild(trigger);
        document.body.appendChild(cseg);

        updateActive(currentSize);

        // 他のUI／画面での変更を同期
        document.addEventListener('kintone-font-size-changed', function (e) {
            currentSize = e.detail;
            updateActive(currentSize);
        });
    }

    // --- スタイル注入 (Allowlist) ---
    // 小(14px) は「デフォルト（無適用）」とし、CSSを一切注入しない（既存の注入があれば削除）。
    // 中(18px)・大(24px) のみ拡大CSSを注入する。
    function applyGlobalFontSize(size) {
        var styleEl = document.getElementById(STYLE_ID);
        if (size === '14px') {
            if (styleEl) styleEl.parentNode.removeChild(styleEl);
            return;
        }
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.innerHTML = generateCustomCss(size);
    }

    function generateCustomCss(size) {
        // [Block 1] 対象の定義 (Allowlist)
        // 通知カード・スペース一覧・アプリ一覧を巻き込まないよう、広い親要素ではなく
        // 「読む本文」系のコンテナ／要素だけを対象にします。
        var targetAreas = [
            '.ocean-portal-announcement-body',           // ポータルのお知らせ本文（PC）
            '.ocean-space-thread-body',                  // スレッド本文（PC）
            '.ocean-space-spacebody',                    // スペーストップの本文ウィジェット（PC）
            '.ocean-ui-comments-view',                   // コメントエリア
            '.goog-window-body',                         // ポップアップウィンドウ（ルックアップ等）
            '.gaia-mobile-v2-view-panel-content',        // モバイル版のビューパネル
            '.gaia-mobile-v2-portal-announcementcontents', // ポータルのお知らせ本文（モバイル）
            '.gaia-mobile-v2-space-thread-threadbody',     // スレッド本文（モバイル）
            '.gaia-mobile-v2-space-spacebody'              // スペーストップの本文ウィジェット（モバイル）
        ];
        var baseSelector = targetAreas.join(', ');

        // レコード系はアプリ画面全体を巻き込まないよう、値・ラベル・セルをピンポイント指定します。
        var directTextSelectors = [
            '.control-value-gaia',   // レコード値
            '.control-label-gaia',   // レコード項目ラベル
            '.subtable-row-gaia td', // サブテーブル内の値
            '.subtable-row-gaia th',
            '.recordlist-cell-gaia'  // レコード一覧セル
        ];
        var directTextSelector = directTextSelectors.join(', ');

        // Block 5・6 で使う「対象スコープ」（コンテナ＋レコード系）
        var textScopes = targetAreas.concat(directTextSelectors);

        // [Block 2] メインテキストのスタイル
        var mainTextBlock = `
            ${baseSelector},
            ${directTextSelector} {
                font-size: ${size} !important;
                line-height: 1.5 !important;
            }
        `;

        // [Block 3] フォーム要素のスタイル
        // 対象コンテナ内の input, textarea, select を対象にします。
        var formSelectors = targetAreas.map(function (s) { return s + ' input'; }).join(', ') + ', ' +
            targetAreas.map(function (s) { return s + ' textarea'; }).join(', ') + ', ' +
            targetAreas.map(function (s) { return s + ' select'; }).join(', ');

        var formControlBlock = `
            ${formSelectors} {
                font-size: ${size} !important;
            }
        `;

        // [Block 4] ボタンのスタイル
        // アイコンボタン (.kintoneplugin-button-icon) は除外します。
        var buttonSelectors = targetAreas.map(function (s) { return s + ' button:not(.kintoneplugin-button-icon)'; }).join(', ');

        var buttonBlock = `
            ${buttonSelectors} {
                 font-size: ${size} !important;
                 padding: 0.6em 1.2em !important;
                 height: auto !important;
            }
        `;

        // [Block 5] リッチテキスト等のインライン font-size の上書き
        // お知らせ・スレッド本文などは各要素（span 等）に font-size がインライン指定されており、
        // コンテナへの継承だけでは効きません。対象スコープ配下のテキスト要素を直接 !important で
        // 上書きすることで、インライン指定（例: font-size: large）を上書きします。
        var textTags = ['span', 'p', 'li', 'a', 'strong', 'em', 'b', 'u', 'td', 'th', 'dd', 'dt', 'blockquote', 'label'];
        var textSelectors = [];
        textScopes.forEach(function (area) {
            textTags.forEach(function (t) { textSelectors.push(area + ' ' + t); });
        });
        var textDescendantBlock = `
            ${textSelectors.join(', ')} {
                font-size: ${size} !important;
            }
        `;

        // [Block 6] 例外・調整用スタイル
        // アイコンフォントやバッジなど、継承で崩れるものを補正します。
        // 対象スコープ内のアイコンは Block 5 より詳細度を高くして継承に戻し、巻き込みを防ぎます。
        var iconClasses = ['.fa', '.fas', '.far', '.fab', '.gaia-icon', '.kintoneplugin-button-icon'];
        var iconSelectors = [];
        textScopes.forEach(function (area) {
            iconClasses.forEach(function (c) { iconSelectors.push(area + ' ' + c); });
        });
        var exceptionBlock = `
            .fa, .fas, .far, .fab, .gaia-icon { font-size: inherit !important; }
            ${iconSelectors.join(', ')} { font-size: inherit !important; }
            .tab-icon-num-gaia { font-size: 0.8em !important; }
        `;

        // 全ブロックを結合して返します
        return mainTextBlock + formControlBlock + buttonBlock + textDescendantBlock + exceptionBlock;
    }
})();
