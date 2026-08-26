/**
 * portal-shortcut.js
 * Kintone ポータル画面のショートカット機能（アプリボタン ＋ 色/形変更ボタン ＋ 個人カスタマイズ）。
 *
 * 【共有コーディネーター】
 *   window.PortalCustomize として、ポータル上部のコンテナとマウントスロットを提供する。
 *   - 冪等（idempotent）初期化: 何度呼んでもコンテナは1度しか生成しない。
 *   - 重複防止ID: 既存ファイルと同一の 'my-custom-app-container'
 *     （現適用ファイルの分割完了後にドロップイン置換するため）。
 *   - 提供スロット:
 *       スロット1 = ショートカットボタン群 ... addShortcutItem(el)
 *       スロット2 = 色/形/個人設定ボタン（configContainer 左） ... addConfigItem(el)
 *       スロット3 = フォントボタン群（configContainer 右寄せ）
 *                  ... 本ファイルでは未使用。第2フェーズで font-size-changer.js が
 *                      getConfigContainer() を取得し、marginLeft:auto のボタン群を
 *                      appendChild してマウントする。
 *
 *   ※ フォント設定（localStorageキー・kintone-font-size-changed イベント）は
 *     フォント側の所有物。本ファイルからは一切触れない。
 *
 * 【個人カスタマイズ（⚙️）】
 *   ポータル上部の ⚙️ ボタンから、ショートカットの遷移先・表示名・並び順・個数を
 *   ユーザー本人が編集できる。設定は localStorage にログインユーザー単位で保存され、
 *   端末・ブラウザ間の同期は行わない。未設定時は appList（管理者既定値）を表示する。
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

    // --- 個人カスタマイズ 用 定数 ---
    var MIN_SHORTCUTS = 4;
    var MAX_SHORTCUTS = 6;
    var SETTINGS_SCHEMA_VERSION = 1;
    var STORAGE_KEY_PREFIX = 'kintone_portal_shortcuts';
    var STORAGE_KEY_FALLBACK = 'kintone_portal_shortcuts_default';
    var BTN_MARKER_ATTR = 'data-shortcut-btn'; // ショートカットボタン再描画時の削除対象マーカー（data-shortcut-renderedとは別物）
    var MODAL_STYLE_ID = 'portal-shortcut-modal-style';

    // --- 配置するアプリ一覧（管理者既定値。ユーザーが ⚙️ で未設定の場合にこの内容が表示される） ---
    var appList = [
        { id: 'your-app-id-1', name: 'アプリ名1' },
        { id: 'your-app-id-2', name: 'アプリ名2' },
        { id: 'your-app-id-3', name: 'アプリ名3' },
        { id: 'your-app-id-4', name: 'アプリ名4' }
    ]; // 実際に配置したいアプリのIDと名称に書き換えてください（行数は自由に増減できます）

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
    // 個人カスタマイズ: ユーティリティ
    // ============================================================
    function removeAllChildren(el) {
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

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
        // appList（管理者既定値）を保存データと同じ形へ変換する
        return appList.map(function (app) {
            return { appId: String(app.id), appName: app.name, label: app.name, labelCustom: false };
        });
    }

    function isValidSavedItem(item) {
        return !!item && typeof item === 'object' &&
            typeof item.appId === 'string' && item.appId.length > 0;
    }

    /**
     * 保存済み設定を読み込む。以下はすべて既定 appList へのサイレントフォールバックとする:
     * キー不在 / JSONパース失敗 / 配列でない / 要素数が範囲外 / アプリIDが空 / スキーマ不明。
     */
    function loadShortcutSettings() {
        var raw;
        try {
            raw = localStorage.getItem(getStorageKey());
        } catch (e) {
            return defaultShortcutList();
        }
        if (!raw) return defaultShortcutList();

        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return defaultShortcutList();
        }
        if (!parsed || typeof parsed !== 'object') return defaultShortcutList();
        if (parsed.version !== SETTINGS_SCHEMA_VERSION) return defaultShortcutList();
        if (!Array.isArray(parsed.buttons)) return defaultShortcutList();
        if (parsed.buttons.length < MIN_SHORTCUTS || parsed.buttons.length > MAX_SHORTCUTS) return defaultShortcutList();

        var normalized = [];
        for (var i = 0; i < parsed.buttons.length; i++) {
            var item = parsed.buttons[i];
            if (!isValidSavedItem(item)) return defaultShortcutList();
            var appName = (typeof item.appName === 'string') ? item.appName : '';
            var label = (typeof item.label === 'string' && item.label) ? item.label : (appName || item.appId);
            normalized.push({
                appId: String(item.appId),
                appName: appName,
                label: label,
                labelCustom: !!item.labelCustom
            });
        }
        return normalized;
    }

    /** 保存する。件数(4〜6)・アプリID必須 のバリデーションを再度実施する。 */
    function saveShortcutSettings(list) {
        if (!Array.isArray(list) || list.length < MIN_SHORTCUTS || list.length > MAX_SHORTCUTS) {
            throw new Error('ショートカットは' + MIN_SHORTCUTS + '〜' + MAX_SHORTCUTS + '個にしてください。');
        }
        for (var i = 0; i < list.length; i++) {
            if (!isValidSavedItem(list[i])) {
                throw new Error('アプリが選択されていない行があります。');
            }
        }
        var payload = {
            version: SETTINGS_SCHEMA_VERSION,
            buttons: list.map(function (item) {
                return {
                    appId: item.appId,
                    appName: item.appName || '',
                    label: item.label || item.appName || item.appId,
                    labelCustom: !!item.labelCustom
                };
            })
        };
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
                        results.push({ id: String(apps[i].appId), name: apps[i].name });
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
    // 個人カスタマイズ: 設定モーダルの <style> 注入
    // ============================================================
    function injectModalStyle() {
        if (document.getElementById(MODAL_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = MODAL_STYLE_ID;
        style.textContent =
            '.psm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);' +
            'z-index:100000;display:flex;align-items:center;justify-content:center;}' +
            '.psm-dialog{background:#fff;border-radius:8px;width:520px;max-width:92vw;max-height:86vh;' +
            'display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,0.3);}' +
            '.psm-header{display:flex;justify-content:space-between;align-items:center;' +
            'padding:16px 20px;border-bottom:1px solid #eee;}' +
            '.psm-title{font-size:16px;font-weight:bold;margin:0;}' +
            '.psm-close{background:none;border:none;font-size:20px;cursor:pointer;line-height:1;color:#888;}' +
            '.psm-body{padding:16px 20px;overflow-y:auto;flex:1;}' +
            '.psm-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;' +
            'padding-bottom:12px;border-bottom:1px dashed #eee;flex-wrap:wrap;}' +
            '.psm-row-main{flex:1;min-width:220px;display:flex;flex-direction:column;gap:6px;}' +
            '.psm-input{padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;' +
            'width:100%;box-sizing:border-box;}' +
            '.psm-select{padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;' +
            'width:100%;box-sizing:border-box;background:#fff;}' +
            '.psm-row-actions{display:flex;gap:4px;align-items:center;}' +
            '.psm-icon-btn{min-width:30px;height:30px;padding:0 6px;border:1px solid #ddd;background:#fff;' +
            'border-radius:4px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;}' +
            '.psm-icon-btn:disabled{opacity:0.35;cursor:not-allowed;}' +
            '.psm-warn{color:#c0392b;font-size:12px;margin-top:2px;}' +
            '.psm-footer{display:flex;justify-content:space-between;align-items:center;' +
            'padding:14px 20px;border-top:1px solid #eee;gap:8px;flex-wrap:wrap;}' +
            '.psm-footer-left,.psm-footer-right{display:flex;gap:8px;}' +
            '.psm-btn{padding:8px 14px;border-radius:4px;font-size:13px;cursor:pointer;border:1px solid #ccc;background:#fff;}' +
            '.psm-btn:disabled{opacity:0.4;cursor:not-allowed;}' +
            '.psm-btn-primary{background:#3498db;border-color:#3498db;color:#fff;}' +
            '.psm-error{color:#c0392b;font-size:13px;margin:0 0 10px 0;}' +
            '.psm-loading{padding:40px 0;text-align:center;color:#888;font-size:13px;}' +
            '@media (max-width:600px){' +
            '.psm-overlay{align-items:stretch;justify-content:stretch;}' +
            '.psm-dialog{width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0;}' +
            '.psm-select{font-size:16px;}' +
            '}';
        document.head.appendChild(style);
    }

    // ============================================================
    // 個人カスタマイズ: 設定モーダル本体
    // ============================================================
    var isModalOpen = false; // 多重クリックによる二重オープン防止

    /**
     * ⚙️ モーダルを開く。
     * @param {Function} onSaved 保存成功時に呼ばれるコールバック（ショートカットの即時再描画用）
     */
    function openShortcutSettingsModal(onSaved) {
        if (isModalOpen) return;
        isModalOpen = true;
        injectModalStyle();

        var savedList = loadShortcutSettings();
        // 作業コピー（保存前の編集はここにのみ反映し、キャンセル時は破棄する）
        var workingList = savedList.map(function (item) {
            return { appId: item.appId, appName: item.appName, label: item.label, labelCustom: item.labelCustom };
        });
        var dirty = false;
        var loadedApps = [];

        var overlay = document.createElement('div');
        overlay.className = 'psm-overlay';

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

        var errorMsg = document.createElement('p');
        errorMsg.className = 'psm-error';
        errorMsg.style.display = 'none';
        body.appendChild(errorMsg);

        var loadingMsg = document.createElement('div');
        loadingMsg.className = 'psm-loading';
        loadingMsg.textContent = 'アプリ一覧を取得しています...';
        body.appendChild(loadingMsg);

        var rowsContainer = document.createElement('div');
        rowsContainer.style.display = 'none';
        body.appendChild(rowsContainer);

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

        function closeModal() {
            document.body.style.overflow = prevBodyOverflow;
            document.removeEventListener('keydown', onKeyDown);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            isModalOpen = false;
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

        function findAppName(appId) {
            for (var i = 0; i < loadedApps.length; i++) {
                if (loadedApps[i].id === appId) return loadedApps[i].name;
            }
            return null;
        }

        /**
         * 保存済みのアプリ名スナップショットを最新のアプリ名へ追従させる。
         * ユーザーが独自の表示名を付けている行（labelCustom）は表示名を変更しない。
         */
        function refreshAppNames() {
            workingList.forEach(function (item) {
                if (!item.appId) return;
                var latest = findAppName(item.appId);
                if (!latest || latest === item.appName) return;
                if (!item.labelCustom) item.label = latest;
                item.appName = latest;
            });
        }

        function updateFooterState() {
            addBtn.disabled = (workingList.length >= MAX_SHORTCUTS);
        }

        function buildRow(item, index) {
            var row = document.createElement('div');
            row.className = 'psm-row';

            var main = document.createElement('div');
            main.className = 'psm-row-main';

            var select = document.createElement('select');
            select.className = 'psm-select';

            var placeholderOpt = document.createElement('option');
            placeholderOpt.value = '';
            placeholderOpt.textContent = 'アプリを選択してください';
            select.appendChild(placeholderOpt);

            var unavailableEl = null;
            var unavailableOpt = null;
            if (item.appId && !findAppName(item.appId)) {
                // 削除済み・権限なしのアプリを select が勝手に別アプリへ変えてしまわないよう、
                // 選択中のIDを保持する一時的な option を先頭付近に差し込んでおく。
                unavailableOpt = document.createElement('option');
                unavailableOpt.value = item.appId;
                // アプリIDは画面に出さないため、アプリ名が不明な場合も汎用文言にとどめる
                unavailableOpt.textContent = (item.appName || '選択中のアプリ') + '（利用できません）';
                select.appendChild(unavailableOpt);

                unavailableEl = document.createElement('div');
                unavailableEl.className = 'psm-warn';
                unavailableEl.textContent = 'このアプリは利用できません（削除済み、または閲覧権限がありません）。差し替えてください。';
            }

            // loadedApps は fetchAllApps 成功時に一度だけアプリ名順にソート済み。
            for (var optIdx = 0; optIdx < loadedApps.length; optIdx++) {
                var appOpt = document.createElement('option');
                appOpt.value = loadedApps[optIdx].id;
                appOpt.textContent = loadedApps[optIdx].name;
                select.appendChild(appOpt);
            }

            select.value = item.appId || '';
            main.appendChild(select);
            if (unavailableEl) main.appendChild(unavailableEl);

            var labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.className = 'psm-input';
            labelInput.placeholder = '表示名';
            labelInput.value = item.label || '';
            main.appendChild(labelInput);

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
                var newAppId = select.value;
                if (!newAppId) {
                    // プレースホルダーが選ばれた場合は未選択として扱う（保存時バリデーションで弾かれる）
                    item.appId = '';
                    dirty = true;
                    return;
                }
                var appName = findAppName(newAppId) || '';
                var wasAutoLabel = !item.labelCustom;
                item.appId = newAppId;
                item.appName = appName;
                if (wasAutoLabel || !labelInput.value) {
                    item.label = appName;
                    labelInput.value = appName;
                    item.labelCustom = false;
                }
                if (unavailableEl && unavailableEl.parentNode) {
                    unavailableEl.parentNode.removeChild(unavailableEl);
                    unavailableEl = null;
                }
                // 利用できないアプリを選び直した後は、その選択肢自体も取り除く
                if (unavailableOpt && unavailableOpt.parentNode && unavailableOpt.value !== newAppId) {
                    unavailableOpt.parentNode.removeChild(unavailableOpt);
                    unavailableOpt = null;
                }
                dirty = true;
            });

            labelInput.addEventListener('input', function () {
                item.label = labelInput.value;
                item.labelCustom = (labelInput.value !== item.appName);
                dirty = true;
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
        }

        addBtn.onclick = function () {
            if (workingList.length >= MAX_SHORTCUTS) return;
            workingList.push({ appId: '', appName: '', label: '', labelCustom: false });
            dirty = true;
            renderRows();
            var selects = rowsContainer.querySelectorAll('.psm-select');
            if (selects.length) selects[selects.length - 1].focus(); // 追加行のアプリ選択欄
        };

        resetBtn.onclick = function () {
            if (!window.confirm('保存済みのショートカット設定を削除し、既定のアプリ一覧に戻します。よろしいですか？')) return;
            resetShortcutSettings();
            dirty = false;
            closeModal();
            onSaved();
        };

        saveBtn.onclick = function () {
            showError('');
            for (var i = 0; i < workingList.length; i++) {
                if (!workingList[i].appId) {
                    showError('すべての行でアプリを選択してください。');
                    return;
                }
            }
            if (workingList.length < MIN_SHORTCUTS || workingList.length > MAX_SHORTCUTS) {
                showError('ショートカットは' + MIN_SHORTCUTS + '〜' + MAX_SHORTCUTS + '個にしてください。');
                return;
            }
            try {
                saveShortcutSettings(workingList);
            } catch (e) {
                showError((e && e.message) ? e.message : '保存に失敗しました。');
                return;
            }
            dirty = false;
            closeModal();
            onSaved();
        };

        // --- 画面へ追加＆背景スクロール抑止 ---
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', onKeyDown);
        document.body.appendChild(overlay);

        // --- アプリ一覧取得（モーダルを開いた時のみ） ---
        fetchAllApps(function (apps) {
            loadedApps = apps;
            refreshAppNames();
            loadingMsg.style.display = 'none';
            rowsContainer.style.display = 'block';
            renderRows();
            var firstSelect = rowsContainer.querySelector('.psm-select');
            if (firstSelect) firstSelect.focus();
        }, function () {
            loadingMsg.style.display = 'none';
            showError('アプリ一覧の取得に失敗しました。時間をおいて再度お試しください。既存の設定は変更されていません。');
            addBtn.disabled = true;
            resetBtn.disabled = true;
            saveBtn.disabled = true;
        });
    }

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

        // 二重描画防止（このファイル分のマーカー。ショートカット再描画時もこのマーカー自体は変更しない）
        if (container.getAttribute('data-shortcut-rendered') === 'true') return event;
        container.setAttribute('data-shortcut-rendered', 'true');

        var savedThemeIdx = parseInt(localStorage.getItem('kintone_portal_theme_idx'), 10);
        var savedShapeIdx = parseInt(localStorage.getItem('kintone_portal_shape_idx'), 10);
        var currentThemeIdx = isNaN(savedThemeIdx) ? 0 : savedThemeIdx;
        var currentShapeIdx = isNaN(savedShapeIdx) ? 0 : savedShapeIdx;

        // --- アプリボタン生成（スロット1） ---
        var createdButtons = [];

        function clearShortcutButtons() {
            var olds = container.querySelectorAll('[' + BTN_MARKER_ATTR + '="true"]');
            for (var i = 0; i < olds.length; i++) {
                if (olds[i].parentNode) olds[i].parentNode.removeChild(olds[i]);
            }
        }

        /** 設定配列からショートカットボタンを描画し直す（保存直後もリロードなしで呼べる） */
        function redrawShortcuts() {
            var list = loadShortcutSettings();
            clearShortcutButtons();
            createdButtons.length = 0;

            list.forEach(function (item) {
                var linkBtn = document.createElement('a');
                linkBtn.setAttribute(BTN_MARKER_ATTR, 'true');
                linkBtn.href = '/k/' + item.appId + '/';
                linkBtn.textContent = item.label || item.appName || item.appId;
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

            updateStyles();
        }

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

        redrawShortcuts();

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

        var settingsBtn = createConfigBtn('⚙️', 'ショートカットを編集');
        settingsBtn.onclick = function () {
            openShortcutSettingsModal(redrawShortcuts);
        };

        PortalCustomize.addConfigItem(colorBtn);
        PortalCustomize.addConfigItem(shapeBtn);
        PortalCustomize.addConfigItem(settingsBtn);

        return event;
    });
})();
