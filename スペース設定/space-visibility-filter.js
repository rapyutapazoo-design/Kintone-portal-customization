/**
 * ポータルのスペース一覧 表示制御（ホワイトリスト方式）
 * ------------------------------------------------------------
 * Kintone のポータルに表示される「スペース」一覧から、
 * ホワイトリストに登録されていない公開スペースを非表示にします。
 *
 * ねらい:
 *   マンションのコミュニティ用スペースはハブスペース経由でアクセスさせたいため、
 *   ポータルの一覧には出さない。ただしスペース自体は公開のままなので、
 *   ハブスペースのリンクから誰でも自由に参加できます。
 *
 * 重要:
 *   これはセキュリティ機能ではなく「見た目の整理」です。
 *   URL 直打ち・検索・通知からは引き続きアクセスできます。
 *
 * 仕様:
 *   - VISIBLE_SPACE_IDS に含まれるスペース         → 表示
 *   - 鍵マーク付き（非公開）スペース               → 表示（Kintone 標準で参加者にしか出ないため）
 *   - ALWAYS_KEEP_SPACE_IDS に含まれるスペース     → 表示（保険用）
 *   - スペース ID を判定できなかった要素           → 表示（安全側に倒す）
 *   - 上記以外の公開スペース                       → 非表示
 *   - 除外対象ユーザー / グループ / 組織           → 非表示処理そのものをスキップ
 *
 * 適用先: cybozu.com 共通管理 → JavaScript / CSS カスタマイズ（PC 用・モバイル用の両方に設定）
 */
(function () {
  'use strict';

  // ============================================================
  // 設定（運用時はこのブロックだけを編集してください）
  // ============================================================
  var CONFIG = {
    // ポータルに表示し続けるスペース ID。ここに無い公開スペースは隠れます。
    //   2 = 餅つき親睦会 / 3 = 防災 / 6 = アップデートノート / 16 = ハブスペース
    VISIBLE_SPACE_IDS: ['2', '3', '6', '16'],

    // 鍵マーク（非公開）付きのスペースを非表示の対象から外すか。
    // 非公開スペースは Kintone 標準で参加者にしか表示されないため、通常は true のまま。
    KEEP_PRIVATE_SPACES: true,

    // 【保険】鍵マークの自動判定が Kintone の仕様変更で壊れ、
    // 非公開スペースがポータルから消えてしまった場合に、その ID をここへ追加すると復旧します。
    // 例: ALWAYS_KEEP_SPACE_IDS: ['1', '11', '12', '14']
    ALWAYS_KEEP_SPACE_IDS: [],

    // 非表示処理を適用しない（＝全スペースがそのまま見える）ユーザーコード。
    // API に一切依存しないため、確実に効かせたい場合はこちらを使ってください。
    EXCLUDE_USER_CODES: [],

    // 非表示処理を適用しないグループコード。
    EXCLUDE_GROUP_CODES: ['デジタル委員会', 'Administrators'],

    // 非表示処理を適用しない組織コード。
    EXCLUDE_ORGANIZATION_CODES: [],

    // 表示対象が 0 件になったとき、スペースウィジェットごと隠すか
    HIDE_WIDGET_WHEN_EMPTY: true,

    // true にするとブラウザのコンソールに判定結果を出力します（調査用）
    DEBUG: false
  };

  // ============================================================
  // 以下は通常編集不要
  // ============================================================

  var LOG_PREFIX = '[space-visibility-filter]';
  var STORAGE_KEY = 'space-visibility-filter:excluded';
  var FILTERED_ATTR = 'data-space-visibility-filtered';
  var PREHIDE_STYLE_ID = 'space-visibility-filter-prehide';
  var PREHIDE_TIMEOUT_MS = 2000;
  var RETRY_INTERVAL_MS = 100;
  var RETRY_MAX = 30;

  /** 画面種別ごとの DOM セレクタ（2026-08 時点の Kintone で実機確認済み） */
  var TARGETS = {
    desktop: {
      name: 'desktop',
      widget: 'div.ocean-portal-space',
      item: 'a.gaia-argoui-spacescrollinglist-item',
      row: 'li',
      privateMark: '.gaia-argoui-spacescrollinglist-private',
      list: 'ul.gaia-argoui-spacescrollinglist-list'
    },
    mobile: {
      name: 'mobile',
      widget: 'div.gaia-mobile-v2-portal-spacewidget-container',
      item: 'a.gaia-mobile-v2-ui-space-spacelist-item-link',
      row: 'li',
      privateMark: '.gaia-mobile-v2-ui-space-spacelist-item-private-icon',
      list: 'ul.gaia-mobile-v2-ui-space-spacelist-list'
    }
  };

  var observer = null;
  var prehideTimer = null;
  // 除外対象と確定したら true。以降は再試行・監視も含めて一切の非表示処理を行わない
  var disabled = false;

  function log() {
    if (!CONFIG.DEBUG) {
      return;
    }
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, [LOG_PREFIX].concat(args));
  }

  function warn() {
    var args = Array.prototype.slice.call(arguments);
    console.warn.apply(console, [LOG_PREFIX].concat(args));
  }

  // ------------------------------------------------------------
  // ちらつき防止: スクリプト読み込み時点で一覧を不可視にし、
  // 判定完了後（またはタイムアウト後）に必ず戻す
  // ------------------------------------------------------------

  function preHide() {
    if (document.getElementById(PREHIDE_STYLE_ID)) {
      schedulePreHideRelease();
      return;
    }
    var style = document.createElement('style');
    style.id = PREHIDE_STYLE_ID;
    style.textContent =
      TARGETS.desktop.widget + ' ' + TARGETS.desktop.list + ',' +
      TARGETS.mobile.widget + ' ' + TARGETS.mobile.list +
      '{visibility:hidden !important;}';
    (document.head || document.documentElement).appendChild(style);
    schedulePreHideRelease();
  }

  function schedulePreHideRelease() {
    if (prehideTimer) {
      clearTimeout(prehideTimer);
    }
    // 何があっても一覧が隠れたままにならないようにするための保険
    prehideTimer = setTimeout(releasePreHide, PREHIDE_TIMEOUT_MS);
  }

  function releasePreHide() {
    if (prehideTimer) {
      clearTimeout(prehideTimer);
      prehideTimer = null;
    }
    var style = document.getElementById(PREHIDE_STYLE_ID);
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  // ------------------------------------------------------------
  // 判定ロジック
  // ------------------------------------------------------------

  /** href からスペース ID を取り出す（PC: /k/#/space/3 、モバイル: /k/m/space/3） */
  function extractSpaceId(item) {
    var href = item.getAttribute('href') || '';
    var matched = href.match(/\/space\/(\d+)/);
    return matched ? matched[1] : null;
  }

  /**
   * 鍵マーク（非公開スペース）かどうか。
   * 実機で確認したクラス名を第一候補にしつつ、Kintone 側の仕様変更に備えて
   * class 名に private / lock を含む要素も広めに拾う。
   */
  function isPrivateSpace(row, target) {
    if (row.querySelector(target.privateMark)) {
      return true;
    }
    return !!row.querySelector('[class*="private" i], [class*="lock" i]');
  }

  function shouldKeep(spaceId, row, target) {
    if (spaceId === null) {
      return true; // ID を判定できないものは消さない
    }
    if (CONFIG.VISIBLE_SPACE_IDS.indexOf(spaceId) !== -1) {
      return true;
    }
    if (CONFIG.ALWAYS_KEEP_SPACE_IDS.indexOf(spaceId) !== -1) {
      return true;
    }
    if (CONFIG.KEEP_PRIVATE_SPACES && isPrivateSpace(row, target)) {
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  // 表示・非表示の適用
  // ------------------------------------------------------------

  function hideRow(row) {
    if (row.getAttribute(FILTERED_ATTR) === 'true') {
      return;
    }
    row.setAttribute(FILTERED_ATTR, 'true');
    row.style.display = 'none';
  }

  function showRow(row) {
    if (row.getAttribute(FILTERED_ATTR) !== 'true') {
      return;
    }
    row.removeAttribute(FILTERED_ATTR);
    row.style.display = '';
  }

  /**
   * @returns {boolean} スペース一覧を見つけて処理できたら true
   */
  function applyFilter(target) {
    var widget = document.querySelector(target.widget);
    if (!widget) {
      return false;
    }
    var items = widget.querySelectorAll(target.item);
    if (!items.length) {
      return false;
    }

    var visibleCount = 0;
    var hidden = [];

    Array.prototype.forEach.call(items, function (item) {
      var row = item.closest(target.row) || item;
      var spaceId = extractSpaceId(item);
      if (shouldKeep(spaceId, row, target)) {
        showRow(row);
        visibleCount++;
      } else {
        hideRow(row);
        hidden.push(spaceId);
      }
    });

    if (CONFIG.HIDE_WIDGET_WHEN_EMPTY) {
      widget.style.display = visibleCount === 0 ? 'none' : '';
    }

    log(target.name, '対象', items.length, '件 / 表示', visibleCount, '件 / 非表示', hidden);
    return true;
  }

  /** 除外対象と判明したときに、隠したものをすべて元に戻す */
  function restoreAll(target) {
    var rows = document.querySelectorAll('[' + FILTERED_ATTR + '="true"]');
    Array.prototype.forEach.call(rows, showRow);
    var widget = document.querySelector(target.widget);
    if (widget) {
      widget.style.display = '';
    }
    log(target.name, '除外対象のため元に戻しました');
  }

  /**
   * スペースウィジェットは遅延描画されるため、見つかるまで短い間隔で再試行する。
   * 見つかった後は MutationObserver で追加読み込み・再描画に追従する。
   */
  function applyWithRetry(target, remaining) {
    if (disabled) {
      releasePreHide();
      return;
    }
    if (applyFilter(target)) {
      releasePreHide();
      startObserver(target);
      return;
    }
    if (remaining <= 0) {
      log(target.name, 'スペース一覧が見つかりませんでした');
      releasePreHide();
      return;
    }
    setTimeout(function () {
      applyWithRetry(target, remaining - 1);
    }, RETRY_INTERVAL_MS);
  }

  function startObserver(target) {
    stopObserver();
    var widget = document.querySelector(target.widget);
    if (!widget || typeof MutationObserver === 'undefined') {
      return;
    }
    // 監視するのは要素の増減のみ。自身の style 変更では発火しないため無限ループしない
    observer = new MutationObserver(function () {
      if (disabled) {
        return;
      }
      applyFilter(target);
    });
    observer.observe(widget, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ------------------------------------------------------------
  // 除外ユーザー判定
  // ------------------------------------------------------------

  function readCache(userCode) {
    try {
      return sessionStorage.getItem(STORAGE_KEY + ':' + userCode);
    } catch (e) {
      return null;
    }
  }

  function writeCache(userCode, value) {
    try {
      sessionStorage.setItem(STORAGE_KEY + ':' + userCode, value);
    } catch (e) {
      // プライベートブラウジング等で失敗しても処理は続行する
    }
  }

  function hasIntersection(codes, targetCodes) {
    return codes.some(function (code) {
      return targetCodes.indexOf(code) !== -1;
    });
  }

  /** 所属グループコードを取得。取得できなければ空配列（＝除外しない） */
  function fetchGroupCodes(userCode) {
    if (!CONFIG.EXCLUDE_GROUP_CODES.length) {
      return Promise.resolve([]);
    }
    return kintone
      .api(kintone.api.url('/v1/user/groups', true), 'GET', { code: userCode })
      .then(function (resp) {
        return (resp.groups || []).map(function (group) {
          return group.code;
        });
      });
  }

  /** 所属組織コードを取得。取得できなければ空配列（＝除外しない） */
  function fetchOrganizationCodes(userCode) {
    if (!CONFIG.EXCLUDE_ORGANIZATION_CODES.length) {
      return Promise.resolve([]);
    }
    return kintone
      .api(kintone.api.url('/v1/user/organizations', true), 'GET', { code: userCode })
      .then(function (resp) {
        var titles = resp.organizationTitles || [];
        return titles
          .map(function (entry) {
            return entry.organization ? entry.organization.code : null;
          })
          .filter(Boolean);
      });
  }

  function checkExcluded(user) {
    return Promise.all([
      fetchGroupCodes(user.code),
      fetchOrganizationCodes(user.code)
    ]).then(function (results) {
      var inGroup = hasIntersection(results[0], CONFIG.EXCLUDE_GROUP_CODES);
      var inOrg = hasIntersection(results[1], CONFIG.EXCLUDE_ORGANIZATION_CODES);
      log('所属グループ', results[0], '/ 所属組織', results[1]);
      return inGroup || inOrg;
    });
  }

  // ------------------------------------------------------------
  // エントリーポイント
  // ------------------------------------------------------------

  function run(target) {
    var user = kintone.getLoginUser();

    // ユーザーコード指定は API 不要で即座に判定できる
    if (CONFIG.EXCLUDE_USER_CODES.indexOf(user.code) !== -1) {
      log('除外ユーザーのためスキップ:', user.code);
      releasePreHide();
      return;
    }

    var cached = readCache(user.code);
    if (cached === 'yes') {
      log('除外対象（キャッシュ）のためスキップ:', user.code);
      releasePreHide();
      return;
    }

    // 先に非表示処理を適用する。一般ユーザーはこの時点で完了しちらつかない
    applyWithRetry(target, RETRY_MAX);

    if (cached !== null) {
      return;
    }

    // グループ・組織の判定は非同期。除外対象だった場合のみ元に戻す（セッション中1回だけ）
    checkExcluded(user)
      .then(function (excluded) {
        writeCache(user.code, excluded ? 'yes' : 'no');
        if (excluded) {
          disabled = true;
          stopObserver();
          restoreAll(target);
        }
      })
      .catch(function (error) {
        // 取得できない場合は除外なしとして扱う（非表示は見た目の整理であり業務影響がないため）
        log('除外判定に失敗したため、非表示処理を維持します', error);
      });
  }

  function safeRun(target) {
    try {
      preHide();
      run(target);
    } catch (error) {
      // 何が起きても一覧が隠れたままにならないようにする
      releasePreHide();
      warn('処理中にエラーが発生したため、非表示処理を中止しました', error);
    }
  }

  // 読み込み直後から一覧を不可視にしておき、ちらつきを防ぐ
  preHide();

  kintone.events.on('portal.show', function (event) {
    safeRun(TARGETS.desktop);
    return event;
  });

  kintone.events.on('mobile.portal.show', function (event) {
    safeRun(TARGETS.mobile);
    return event;
  });
})();
