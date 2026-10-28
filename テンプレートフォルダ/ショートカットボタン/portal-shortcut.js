/**
 * 【バックアップ（従来版・ロールバック用）】
 * 2026-10-28 から運用は ポータルナビ/portal-navigation.js に移っています。
 * このファイルは、元に戻す手順（ロールバック）のために残しています。
 *   - 通常は登録しないでください。portal-navigation.js と同時に登録しないでください。
 *   - 機能追加はしません（修正は portal-navigation.js 側で行います）。
 *   - 個人設定アプリのデータは互換です（baseRev は無視されます）。
 *
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
 *   ユーザー本人が編集できる。設定は localStorage にログインユーザー単位でキャッシュされ、
 *   未設定時は appList（管理者既定値）を表示する。
 *   遷移先はアプリに加えスペースも登録できる（select 内で <optgroup> により混在提示）。
 *   スペース候補は /k/v1/apps.json の各アプリが持つ spaceId をユニーク化して取得するほか
 *   （アプリを1つも持たないスペースは候補に出ないため）、スペースのURLまたはIDを貼り付けて
 *   候補に追加することもできる。設定スキーマは v2（{type, targetId, targetName, label,
 *   labelCustom}）で、v1形式（{appId, appName, label, labelCustom}）のデータは読み込み時に
 *   自動的に v2 形へ移行され、保存は常に v2 で行われる。
 *
 * 【端末間同期（任意）】
 *   別途用意した「設定アプリ」（フィールド: login_name / settings_json）を使い、
 *   ユーザーが「すべての端末で共有する（既定）／この端末だけに保存する」を選べる。
 *   SETTINGS_APP_ID がプレースホルダーのままの場合は同期機能自体が無効化され、
 *   リモートAPIは一切呼ばれず、従来どおり端末（localStorage）ごとの保存で動作する。
 *   ポータル描画は常に localStorage キャッシュから即時に行い、同期は描画後に非同期で
 *   後追いする（初期表示速度に影響しない）。
 */
(function () {
    "use strict";

    var CONTAINER_ID = 'my-custom-app-container';
    var CONFIG_ID = 'portal-customize-config';
    var PORTAL_EVENTS = ['portal.show', 'mobile.portal.show'];

    // --- ショートカット用 定数 ---
    // base / tint は設定モーダルのテーマ連動用の派生色（単色）。
    // grad / shadow はショートカットボタン本体が使う既存の値であり、変更しないこと。
    var THEMES = [
        { name: 'navy', grad: 'linear-gradient(135deg, #154260 0%, #2b7bc0 100%)', shadow: '0 4px 10px rgba(21, 66, 96, 0.4)', base: '#154260', tint: '#dbe9f5' },
        { name: 'green', grad: 'linear-gradient(135deg, #134E5E 0%, #71B280 100%)', shadow: '0 4px 10px rgba(19, 78, 94, 0.4)', base: '#134E5E', tint: '#d9ebe4' },
        { name: 'purple', grad: 'linear-gradient(135deg, #4b134f 0%, #c94b4b 100%)', shadow: '0 4px 10px rgba(75, 19, 79, 0.4)', base: '#4b134f', tint: '#ecdcee' },
        { name: 'standard', grad: '#3498db', shadow: '0 4px 10px rgba(52, 152, 219, 0.4)', base: '#2d80b8', tint: '#dbeaf6' }
    ];
    var SHAPES = [
        { name: 'capsule', radius: '30px' },
        { name: 'rounded', radius: '8px' }
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

    /**
     * localStorage に保存された添字から要素を取り出す。
     * 未設定・数値でない・範囲外の場合は先頭要素にフォールバックする。
     */
    function pickByStoredIndex(list, storageKey) {
        var idx = 0;
        try {
            var parsed = parseInt(localStorage.getItem(storageKey), 10);
            if (!isNaN(parsed) && parsed >= 0 && parsed < list.length) {
                idx = parsed;
            }
        } catch (e) {
            // 既定（先頭）へ
        }
        return list[idx];
    }

    /** 設定モーダルのテーマ連動用。現在のテーマ（色）を返す。 */
    function getCurrentTheme() {
        return pickByStoredIndex(THEMES, 'kintone_portal_theme_idx');
    }

    /** 設定モーダルのプレビュー用。現在の形状（角丸）を返す。 */
    function getCurrentShape() {
        return pickByStoredIndex(SHAPES, 'kintone_portal_shape_idx');
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
     * 設定JSON文字列をパース・バリデーションする。以下はすべて null（無効）とする:
     * 値なし / JSONパース失敗 / 配列でない / 要素数が範囲外 / 要素が不正 / スキーマ不明。
     * localStorage から読む場合・リモート（設定アプリ）から読む場合の両方で共用する。
     * v1（SETTINGS_SCHEMA_VERSION_LEGACY）データは読み込み時に自動的に v2 形へ移行する。
     */
    function parseSettingsJson(raw) {
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
        if (!Array.isArray(parsed.buttons)) return null;
        if (parsed.buttons.length < MIN_SHORTCUTS || parsed.buttons.length > MAX_SHORTCUTS) return null;

        var isLegacy = (ver === SETTINGS_SCHEMA_VERSION_LEGACY);
        var normalized = [];
        for (var i = 0; i < parsed.buttons.length; i++) {
            var item = parsed.buttons[i];
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
     * 保存済み設定（localStorageキャッシュ）を読み込む。無効な場合は既定 appList へフォールバックする。
     */
    function loadShortcutSettings() {
        var raw;
        try {
            raw = localStorage.getItem(getStorageKey());
        } catch (e) {
            return defaultShortcutList();
        }
        var normalized = parseSettingsJson(raw);
        return normalized || defaultShortcutList();
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

    /** localStorage 保存 / リモート保存の両方で使う、共通スキーマ（v2）のペイロードを組み立てる。 */
    function buildSettingsPayload(list) {
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
            })
        };
    }

    /** 保存する。件数(4〜6)・アプリID必須 のバリデーションを再度実施する。 */
    function saveShortcutSettings(list) {
        validateShortcutList(list);
        var payload = buildSettingsPayload(list);
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

    function getLoginName() {
        try {
            var user = kintone.getLoginUser();
            if (user && user.code) return user.code;
        } catch (e) {
            // 取得不可
        }
        return null;
    }

    /** 設定アプリから、自分（ログイン名一致）のレコードを1件取得する。なければ null を返す。 */
    function fetchRemoteRecord(onSuccess, onError) {
        var loginName = getLoginName();
        if (!loginName) {
            onError(new Error('ログインユーザー情報を取得できません。'));
            return;
        }
        var query = FIELD_LOGIN_NAME + ' = "' + loginName.replace(/"/g, '\\"') + '" limit 1';
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
        var jsonStr = JSON.stringify(buildSettingsPayload(list));

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
            var normalized = parseSettingsJson(remoteRaw);
            if (!normalized) return;

            var payloadStr = JSON.stringify(buildSettingsPayload(normalized));
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
            console.error('portal-shortcut: リモート設定の取得に失敗しました。', err);
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
                console.error('portal-shortcut: スペース情報の取得に失敗しました。', spaceId, err);
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
            console.warn('portal-shortcut: スペース候補数が上限を超えたため切り詰めます。', ids.length, '>', SPACE_FETCH_MAX);
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

        var savedList = loadShortcutSettings();
        // 作業コピー（保存前の編集はここにのみ反映し、キャンセル時は破棄する）
        var workingList = savedList.map(function (item) {
            return { type: item.type, targetId: item.targetId, targetName: item.targetName, label: item.label, labelCustom: item.labelCustom };
        });
        var dirty = false;
        var loadedApps = [];
        var loadedSpaces = [];
        var selectedMode = getStorageMode(); // 保存先モード（'app'=共有 / 'local'=この端末だけ）。既定は共有。

        // 現在のテーマ・形状（🎨 / 🔲 の選択値）。モーダルの配色とプレビューに使う。
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

        /** loadedSpaces をスペース名順に整え、セッションキャッシュにも反映する。 */
        function sortLoadedSpaces() {
            loadedSpaces.sort(function (a, b) {
                return a.name.localeCompare(b.name, 'ja');
            });
            spaceListCache = loadedSpaces;
        }

        /**
         * 保存済み設定に含まれるスペースのうち、候補一覧（loadedSpaces）に無いものを個別に解決する。
         * アプリを1つも持たないスペースは apps.json の spaceId から辿れないため、URL貼り付けで登録した
         * スペースがこの処理なしでは次回オープン時に「（利用できません）」と誤表示されてしまう。
         * 取得に失敗したものは解決せず、従来どおり「（利用できません）」として扱う。
         * 成否にかかわらず onDone は必ず1回だけ呼ぶ。
         */
        function resolveMissingSpaces(onDone) {
            var known = {};
            var i;
            for (i = 0; i < loadedSpaces.length; i++) {
                known[loadedSpaces[i].id] = true;
            }
            var missing = [];
            for (i = 0; i < workingList.length; i++) {
                var item = workingList[i];
                if (item.type !== TARGET_TYPE_SPACE || !item.targetId) continue;
                if (known[item.targetId]) continue;
                known[item.targetId] = true;
                if (spaceNameCache[item.targetId]) {
                    // 同一セッションで取得済みなら API を呼ばずに候補へ戻す
                    loadedSpaces.push({ id: item.targetId, name: spaceNameCache[item.targetId] });
                    continue;
                }
                missing.push(item.targetId);
            }
            if (!missing.length) {
                sortLoadedSpaces();
                onDone();
                return;
            }

            var remaining = missing.length;
            var finishOne = function () {
                remaining--;
                if (remaining <= 0) {
                    sortLoadedSpaces();
                    onDone();
                }
            };
            missing.forEach(function (spaceId) {
                fetchSpaceById(spaceId, function (space) {
                    loadedSpaces.push(space);
                    finishOne();
                }, function () {
                    // 本当に削除済み・権限なし。従来どおり「（利用できません）」表示に委ねる
                    finishOne();
                });
            });
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
                console.error('portal-shortcut: リモート設定の削除に失敗しました。', err);
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
                console.error('portal-shortcut: リモートへの保存に失敗しました。', err);
                saveBtn.disabled = false;
                saveBtn.textContent = originalSaveLabel;
                showError('設定の保存に失敗しました。ネットワーク状況をご確認いただくか、「この端末だけに保存する」を選んで再度お試しください。');
            });
        };

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
    // タップ演出: <style> 注入
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

    // ============================================================
    // タップ演出: 押下コントローラー
    // ============================================================
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
        var els = document.querySelectorAll('.pst-tap.is-pressed, .pst-tap.is-navigating');
        for (var i = 0; i < els.length; i++) {
            els[i].classList.remove('is-pressed');
            els[i].classList.remove('is-navigating');
        }
    }

    /**
     * 要素にタップ演出（リップル＋遷移中の進捗バー）を付ける。
     * @param {HTMLElement} el 対象要素（className に pst-tap を含めること）
     * @param {boolean} navigates クリックで画面遷移するなら true（遷移中の進捗バーを出す）
     */
    function attachTapFeedback(el, navigates) {
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
            el.style.setProperty('--pst-rx', x + 'px');
            el.style.setProperty('--pst-ry', y + 'px');
            el.style.setProperty('--pst-rd', d + 'px');
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
    // ショートカット機能の描画
    // ============================================================
    // 戻る操作（bfcache）で復元されたとき、遷移中表示が残らないようにする
    window.addEventListener('pageshow', resetTapStates);

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
                attachTapFeedback(linkBtn, true);
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
            attachTapFeedback(btn, false);
            return btn;
        }

        function updateStyles() {
            var theme = THEMES[currentThemeIdx];
            var shape = SHAPES[currentShapeIdx];
            createdButtons.forEach(function (btn) {
                btn.style.background = theme.grad;
                btn.style.boxShadow = theme.shadow;
                btn.style.borderRadius = shape.radius;
                btn.style.setProperty('--pst-base', theme.base); // フォーカス枠の色
            });
            // 🎨🔲⚙️ のフォーカス枠色もテーマに合わせる（コンテナ経由で継承）
            var configEl = document.getElementById(CONFIG_ID);
            if (configEl) {
                configEl.style.setProperty('--pst-base', theme.base);
            }
        }

        redrawShortcuts();
        // キャッシュから即描画した直後、非同期でリモート設定と同期する（共有モード＋同期有効時のみ）。
        // ポータルの初期描画はブロックしない。
        syncFromRemote(redrawShortcuts);

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
