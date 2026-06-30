/**
 * font-size-changer.js
 * Kintone のフォントサイズ変更機能（フローティングUI 一本化版）。
 *
 * 【設計方針】
 *   - 画面右下に常駐するフローティングUI（"Aa" ピル型）で、文字サイズを「小・中・大」から選択する。
 *   - ポータルを含む全画面で同一のUI・操作を提供する（ポータル上部のインラインボタンは持たない）。
 *   - ショートカット機能（portal-shortcut.js）や共有コーディネーター window.PortalCustomize には
 *     一切依存しない、完全に自己完結したファイル。
 *
 * 【対象テキスト（Allowlist方式）】
 *   システムUI（ヘッダー・サイドバー等）の表示崩れを防ぐため、お知らせ・レコード値・コメント等の
 *   「読むテキスト」エリアのみを対象に CSS を注入する（generateCustomCss 参照）。
 */
(function () {
    "use strict";

    // --- 共通定数 ---
    var STORAGE_KEY_SIZE = 'kintone-custom-font-size';
    var STORAGE_KEY_MINIMIZED = 'kintone-font-ui-minimized';
    var STYLE_ID = 'kintone-custom-font-style';

    // フローティングUIを表示する画面（ポータルを含む全画面）
    var FONT_UI_EVENTS = [
        'portal.show', 'mobile.portal.show',
        'app.record.index.show', 'mobile.app.record.index.show',
        'app.record.detail.show', 'mobile.app.record.detail.show',
        'app.report.show',
        'space.portal.show', 'mobile.space.portal.show'
    ];

    // --- メイン処理 ---
    kintone.events.on(FONT_UI_EVENTS, function (event) {
        setupFloatingUI(event);
        return event;
    });

    // 初期化（保存済みサイズを適用）
    var initSize = localStorage.getItem(STORAGE_KEY_SIZE) || '14px';
    applyGlobalFontSize(initSize);

    // --- フローティングUI ---
    function setupFloatingUI(event) {
        var containerId = 'kintone-global-font-size-changer';
        if (document.getElementById(containerId)) return;
        var isMobile = (event.type.indexOf('mobile') !== -1);
        var container = document.createElement('div');
        container.id = containerId;
        // 固定配置
        Object.assign(container.style, {
            position: 'fixed',
            bottom: isMobile ? '15px' : '20px',
            right: isMobile ? '15px' : '20px',
            zIndex: '10000',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(8px)',
            borderRadius: '9999px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            border: '1px solid rgba(0, 0, 0, 0.05)',
        });
        // ボタンラッパー
        var contentWrapper = document.createElement('div');
        Object.assign(contentWrapper.style, {
            display: 'flex',
            alignItems: 'center',
            padding: '2px',
            transition: 'width 0.2s ease, opacity 0.2s ease',
            overflow: 'hidden',
            height: '32px'
        });
        var isMinimized = localStorage.getItem(STORAGE_KEY_MINIMIZED) === 'true';
        // トグルボタン
        var toggleBtn = document.createElement('button');
        Object.assign(toggleBtn.style, {
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '0',
            width: '36px', height: '36px',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', color: '#555', outline: 'none'
        });
        toggleBtn.innerHTML = '<span style="font-weight:bold; font-family:serif;">Aa</span>';
        function updateState() {
            if (isMinimized) {
                contentWrapper.style.opacity = '0';
                contentWrapper.style.width = '0px';
                toggleBtn.style.color = '#555';
                toggleBtn.style.backgroundColor = 'transparent';
            } else {
                contentWrapper.style.opacity = '1';
                contentWrapper.style.width = '120px';
                toggleBtn.style.color = '#3498db';
                toggleBtn.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';
            }
        }
        toggleBtn.onclick = function (e) {
            e.preventDefault();
            isMinimized = !isMinimized;
            localStorage.setItem(STORAGE_KEY_MINIMIZED, isMinimized);
            updateState();
        };
        // サイズ選択ボタン生成
        var sizes = [
            { label: '小', value: '14px' },
            { label: '中', value: '18px' },
            { label: '大', value: '24px' }
        ];
        sizes.forEach(function (size) {
            var btn = document.createElement('button');
            btn.textContent = size.label;
            Object.assign(btn.style, {
                border: 'none', background: 'transparent', cursor: 'pointer',
                padding: '0 8px', height: '28px', borderRadius: '9999px',
                fontSize: '13px', fontWeight: '600', color: '#555',
                transition: 'all 0.2s ease', outline: 'none', margin: '0 1px',
                whiteSpace: 'nowrap'
            });
            btn._updateActive = function (curr) {
                if (size.value === curr) {
                    btn.style.backgroundColor = '#3498db';
                    btn.style.color = '#fff';
                } else {
                    btn.style.backgroundColor = 'transparent';
                    btn.style.color = '#555';
                }
            };
            btn._updateActive(initSize);
            document.addEventListener('kintone-font-size-changed', function (e) {
                btn._updateActive(e.detail);
            });
            btn.onclick = function (e) {
                e.preventDefault();
                localStorage.setItem(STORAGE_KEY_SIZE, size.value);
                applyGlobalFontSize(size.value);
                var ev = new CustomEvent('kintone-font-size-changed', { detail: size.value });
                document.dispatchEvent(ev);
            };
            contentWrapper.appendChild(btn);
        });
        container.appendChild(contentWrapper);
        container.appendChild(toggleBtn);
        document.body.appendChild(container);
        updateState();
    }

    // --- スタイル注入 (Allowlist) ---
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
        // [Block 1] 対象エリアの定義 (Allowlist)
        // システムUI（ヘッダー、サイドバー等）を除外し、メインコンテンツのみを対象にします。
        var targetAreas = [
            '.ocean-portal-body',           // ポータル画面の本文エリア
            '.gaia-argoui-app-view',        // アプリ一覧・詳細画面のメインエリア
            '.ocean-space-body',            // スペース画面の本文
            '.ocean-ui-comments-view',      // コメントエリア
            '.goog-window-body',            // ポップアップウィンドウ（ルックアップ等）
            '.gaia-mobile-v2-view-panel-content' // モバイル版のビューパネル
        ];
        var baseSelector = targetAreas.join(', ');

        // [Block 2] メインテキストのスタイル
        // 指定エリア内の基本的なフォントサイズを設定します。
        var mainTextBlock = `
            ${baseSelector} {
                font-size: ${size} !important;
                line-height: 1.5 !important;
            }
        `;

        // [Block 3] フォーム要素のスタイル
        // 入力フィールドなどは個別にセレクタを指定して適用します。
        // targetAreas内の input, textarea, select を対象にします。
        var formSelectors = targetAreas.map(function (s) { return s + ' input'; }).join(', ') + ', ' +
            targetAreas.map(function (s) { return s + ' textarea'; }).join(', ') + ', ' +
            targetAreas.map(function (s) { return s + ' select'; }).join(', ');

        var formControlBlock = `
            ${formSelectors},
            .control-value-gaia,
            .control-label-gaia {
                font-size: ${size} !important;
            }
        `;

        // [Block 4] ボタンのスタイル
        // ボタンはサイズ変更に伴いパディングや高さの自動調整も行います。
        // アイコンボタン (.kintoneplugin-button-icon) は除外します。
        var buttonSelectors = targetAreas.map(function (s) { return s + ' button:not(.kintoneplugin-button-icon)'; }).join(', ');

        var buttonBlock = `
            ${buttonSelectors} {
                 font-size: ${size} !important;
                 padding: 0.6em 1.2em !important;
                 height: auto !important;
            }
        `;

        // [Block 5] 例外・調整用スタイル
        // アイコンフォントやバッジなど、継承で崩れるものを補正します。
        var exceptionBlock = `
            .fa, .fas, .far, .fab, .gaia-icon { font-size: inherit !important; }
            .tab-icon-num-gaia { font-size: 0.8em !important; }
        `;

        // 全ブロックを結合して返します
        return mainTextBlock + formControlBlock + buttonBlock + exceptionBlock;
    }
})();
