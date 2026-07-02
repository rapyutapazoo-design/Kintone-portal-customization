/**
 * portal-shortcut.js
 * Kintone ポータル画面のショートカット機能（アプリボタン ＋ 色/形変更ボタン）。
 *
 * 【共有コーディネーター】
 *   window.PortalCustomize として、ポータル上部のコンテナとマウントスロットを提供する。
 *   - 冪等（idempotent）初期化: 何度呼んでもコンテナは1度しか生成しない。
 *   - 重複防止ID: 既存ファイルと同一の 'my-custom-app-container'
 *     （現適用ファイルの分割完了後にドロップイン置換するため）。
 *   - 提供スロット:
 *       スロット1 = ショートカットボタン群 ... addShortcutItem(el)
 *       スロット2 = 色/形ボタン（configContainer 左） ... addConfigItem(el)
 *       スロット3 = フォントボタン群（configContainer 右寄せ）
 *                  ... 本ファイルでは未使用。第2フェーズで font-size-changer.js が
 *                      getConfigContainer() を取得し、marginLeft:auto のボタン群を
 *                      appendChild してマウントする。
 *
 *   ※ フォント設定（localStorageキー・kintone-font-size-changed イベント）は
 *     フォント側の所有物。本ファイルからは一切触れない。
 */
(function () {
    "use strict";

    var CONTAINER_ID = 'my-custom-app-container';
    var CONFIG_ID = 'portal-customize-config';
    var PORTAL_EVENTS = ['portal.show', 'mobile.portal.show'];

    // --- ショートカット用 定数 ---
    var THEMES = [
        { name: 'navy', grad: 'linear-gradient(135deg, #154260 0%, #2b7bc0 100%)', shadow: '0 4px 10px rgba(21, 66, 96, 0.4)' },
        { name: 'green', grad: 'linear-gradient(135deg, #134E5E 0%, #71B280 100%)', shadow: '0 4px 10px rgba(19, 78, 94, 0.4)' },
        { name: 'purple', grad: 'linear-gradient(135deg, #4b134f 0%, #c94b4b 100%)', shadow: '0 4px 10px rgba(75, 19, 79, 0.4)' },
        { name: 'standard', grad: '#3498db', shadow: '0 4px 10px rgba(52, 152, 219, 0.4)' }
    ];
    var SHAPES = [
        { name: 'capsule', radius: '30px' },
        { name: 'rounded', radius: '8px' }
    ];

    // ============================================================
    // 共有コーディネーター: window.PortalCustomize
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

            // --- configContainer（色/形 ＋ フォント の器） ---
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
    // ショートカット機能の描画
    // ============================================================
    kintone.events.on(PORTAL_EVENTS, function (event) {
        var isMobile = (event.type === 'mobile.portal.show');

        var portalSpace = isMobile
            ? kintone.mobile.portal.getContentSpaceElement()
            : kintone.portal.getContentSpaceElement();

        var container = PortalCustomize.init(isMobile, portalSpace);
        if (!container) return event;

        // 二重描画防止（このファイル分のマーカー）
        if (container.getAttribute('data-shortcut-rendered') === 'true') return event;
        container.setAttribute('data-shortcut-rendered', 'true');

        // --- 配置するアプリ一覧 ---
        var appList = [
            { id: 'your-app-id-1', name: 'アプリ名1' },
            { id: 'your-app-id-2', name: 'アプリ名2' },
            { id: 'your-app-id-3', name: 'アプリ名3' },
            { id: 'your-app-id-4', name: 'アプリ名4' }
        ]; // 実際に配置したいアプリのIDと名称に書き換えてください（行数は自由に増減できます）

        var savedThemeIdx = parseInt(localStorage.getItem('kintone_portal_theme_idx'), 10);
        var savedShapeIdx = parseInt(localStorage.getItem('kintone_portal_shape_idx'), 10);
        var currentThemeIdx = isNaN(savedThemeIdx) ? 0 : savedThemeIdx;
        var currentShapeIdx = isNaN(savedShapeIdx) ? 0 : savedShapeIdx;

        // --- アプリボタン生成（スロット1） ---
        var createdButtons = [];
        appList.forEach(function (app) {
            var linkBtn = document.createElement('a');
            linkBtn.href = '/k/' + app.id + '/';
            linkBtn.textContent = app.name;
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
            linkBtn.style.transition = 'all 0.3s ease';
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
            linkBtn.onmouseover = function () {
                this.style.transform = 'translateY(-3px)';
                this.style.filter = 'brightness(1.1)';
            };
            linkBtn.onmouseout = function () {
                this.style.transform = 'translateY(0)';
                this.style.filter = 'brightness(1)';
            };
            createdButtons.push(linkBtn);
            PortalCustomize.addShortcutItem(linkBtn);
        });

        // --- 色/形ボタン（スロット2） ---
        function createConfigBtn(icon, title) {
            var btn = document.createElement('button');
            btn.textContent = icon;
            btn.title = title;
            btn.style.background = '#fff';
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
            btn.style.transition = 'background 0.2s';
            btn.onmouseover = function () { btn.style.background = '#f9f9f9'; };
            btn.onmouseout = function () { btn.style.background = '#fff'; };
            return btn;
        }

        function updateStyles() {
            var theme = THEMES[currentThemeIdx];
            var shape = SHAPES[currentShapeIdx];
            createdButtons.forEach(function (btn) {
                btn.style.background = theme.grad;
                btn.style.boxShadow = theme.shadow;
                btn.style.borderRadius = shape.radius;
            });
        }

        var colorBtn = createConfigBtn('🎨', '色を変更');
        colorBtn.onclick = function () {
            currentThemeIdx = (currentThemeIdx + 1) % THEMES.length;
            localStorage.setItem('kintone_portal_theme_idx', currentThemeIdx);
            updateStyles();
        };

        var shapeBtn = createConfigBtn('🔲', '形を変更');
        shapeBtn.onclick = function () {
            currentShapeIdx = (currentShapeIdx + 1) % SHAPES.length;
            localStorage.setItem('kintone_portal_shape_idx', currentShapeIdx);
            updateStyles();
        };

        PortalCustomize.addConfigItem(colorBtn);
        PortalCustomize.addConfigItem(shapeBtn);

        // 初期スタイル反映
        updateStyles();

        return event;
    });
})();
