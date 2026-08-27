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
 * 仕様（全ユーザー共通。管理者等の特別扱いはありません）:
 *   - VISIBLE_SPACE_IDS に含まれるスペース         → 表示
 *   - 鍵マーク付き（非公開）スペース               → 表示（Kintone 標準で参加者にしか出ないため）
 *   - ALWAYS_KEEP_SPACE_IDS に含まれるスペース     → 表示（保険用）
 *   - 自分が参加済みのスペース                     → 表示
 *   - スペース ID を判定できなかった要素           → 表示（安全側に倒す）
 *   - 上記以外の公開スペース                       → 非表示
 *
 * 「参加済み」の判定方法（PC とモバイルで異なります）:
 *   - モバイル: DOM 上に「参加中」を示すクラスが付くため、それだけで同期的に判定できます。
 *   - PC: 実機で調査した限り、参加状態を示す DOM 上の手がかりが見つかりませんでした。
 *     そのため、いったん非表示と判定したスペースだけに絞って、
 *     kintone REST API（/k/v1/space/members.json）でメンバーかどうかを確認します。
 *     API 呼び出しはホワイトリスト・鍵付きスペースには行われません。
 *     ※ このエンドポイントは kintone.api.url() では正しい URL を作れないため、
 *        パスを直接指定しています（checkMembership 関数のコメント参照）。
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
    //   your-space-id-1 = スペース名1 / your-space-id-2 = スペース名2 ...（実際のIDと名称に書き換えてください）
    VISIBLE_SPACE_IDS: ['your-space-id-1', 'your-space-id-2', 'your-space-id-3', 'your-space-id-4'],

    // 鍵マーク（非公開）付きのスペースを非表示の対象から外すか。
    // 非公開スペースは Kintone 標準で参加者にしか表示されないため、通常は true のまま。
    KEEP_PRIVATE_SPACES: true,

    // 【保険】鍵マークの自動判定が Kintone の仕様変更で壊れ、
    // 非公開スペースがポータルから消えてしまった場合に、その ID をここへ追加すると復旧します。
    // 例: ALWAYS_KEEP_SPACE_IDS: ['your-space-id-1', 'your-space-id-2', 'your-space-id-3', 'your-space-id-4']
    ALWAYS_KEEP_SPACE_IDS: [],

    // 表示対象が 0 件になったとき、スペースウィジェットごと隠すか
    HIDE_WIDGET_WHEN_EMPTY: true,

    // true にするとブラウザのコンソールに判定結果を出力します（調査用）
    DEBUG: false
  };

  // ============================================================
  // 以下は通常編集不要
  // ============================================================

  var LOG_PREFIX = '[space-visibility-filter]';
  var JOIN_CACHE_PREFIX = 'space-visibility-filter:joined:';
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
      // PC は参加状態を示す DOM マーカーが確認できなかったため、API で確認する
      joinedMark: null,
      checkMembershipApi: true,
      list: 'ul.gaia-argoui-spacescrollinglist-list'
    },
    mobile: {
      name: 'mobile',
      widget: 'div.gaia-mobile-v2-portal-spacewidget-container',
      item: 'a.gaia-mobile-v2-ui-space-spacelist-item-link',
      row: 'li',
      privateMark: '.gaia-mobile-v2-ui-space-spacelist-item-private-icon',
      // モバイルは「参加中」バッジに対応するクラスが実機で確認できている
      joinedMark: '.gaia-mobile-v2-ui-space-spacelist-item-tag-joined',
      checkMembershipApi: false,
      list: 'ul.gaia-mobile-v2-ui-space-spacelist-list'
    }
  };

  var observer = null;
  var prehideTimer = null;
  // スペースIDごとのメンバーシップ確認リクエスト状況（重複呼び出し防止。ページ内でのみ有効）
  var membershipRequested = {};

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

  /**
   * 参加済みかどうか。
   * - モバイル: DOM 上の「参加中」マークで同期的に判定する
   * - PC: DOM に手がかりが無いため、過去に API で確認済み（sessionStorage キャッシュが
   *   'yes'）の場合のみ true を返す。これにより、参加済みと確認済みのスペースが
   *   MutationObserver 経由の再判定で非表示に巻き戻ることを防ぐ
   *   （キャッシュを見ない場合、再判定のたびに同期条件だけで評価され直し、
   *   API で確認済みだった事実が失われてしまう）。
   */
  function isJoinedSpace(spaceId, row, target) {
    if (target.joinedMark) {
      if (row.querySelector(target.joinedMark)) {
        return true;
      }
      if (row.querySelector('[class*="joined" i]')) {
        return true;
      }
    }
    if (target.checkMembershipApi && spaceId !== null && readJoinCache(spaceId) === 'yes') {
      return true;
    }
    return false;
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
    if (isJoinedSpace(spaceId, row, target)) {
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

  /** 表示対象が0件ならウィジェットごと隠す。1件でもあれば表示する */
  function refreshWidgetVisibility(target) {
    if (!CONFIG.HIDE_WIDGET_WHEN_EMPTY) {
      return;
    }
    var widget = document.querySelector(target.widget);
    if (!widget) {
      return;
    }
    var items = widget.querySelectorAll(target.item);
    var anyVisible = Array.prototype.some.call(items, function (item) {
      var row = item.closest(target.row) || item;
      return row.style.display !== 'none';
    });
    widget.style.display = anyVisible ? '' : 'none';
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

    var hiddenIds = [];

    Array.prototype.forEach.call(items, function (item) {
      var row = item.closest(target.row) || item;
      var spaceId = extractSpaceId(item);
      if (shouldKeep(spaceId, row, target)) {
        showRow(row);
      } else {
        hideRow(row);
        hiddenIds.push(spaceId);
      }
    });

    refreshWidgetVisibility(target);
    log(target.name, '対象', items.length, '件 / 非表示候補', hiddenIds);
    return true;
  }

  /**
   * スペースウィジェットは遅延描画されるため、見つかるまで短い間隔で再試行する。
   * 見つかった後は MutationObserver で追加読み込み・再描画に追従する。
   */
  function applyWithRetry(target, remaining) {
    if (applyFilter(target)) {
      releasePreHide();
      startObserver(target);
      checkMembershipForCandidates(target);
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
      applyFilter(target);
      checkMembershipForCandidates(target);
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
  // 参加済み判定（PC・API 経由）
  // ------------------------------------------------------------

  function readJoinCache(spaceId) {
    try {
      return sessionStorage.getItem(JOIN_CACHE_PREFIX + spaceId);
    } catch (e) {
      return null;
    }
  }

  function writeJoinCache(spaceId, value) {
    try {
      sessionStorage.setItem(JOIN_CACHE_PREFIX + spaceId, value);
    } catch (e) {
      // プライベートブラウジング等で失敗しても処理は続行する
    }
  }

  /**
   * 指定スペースに自分が参加しているかを API で確認する。
   * このエンドポイントは kintone.api.url() ではなく /k/v1/... を直接指定する必要がある
   * （kintone.api.url() はアプリ・レコード系のエンドポイント用で、スペース系には対応していない）。
   */
  function checkMembership(spaceId) {
    return kintone
      .api('/k/v1/space/members.json', 'GET', { id: spaceId })
      .then(function (resp) {
        var userCode = kintone.getLoginUser().code;
        var members = resp.members || [];
        return members.some(function (member) {
          return member && member.entity &&
            member.entity.type === 'USER' &&
            member.entity.code === userCode;
        });
      });
  }

  /** 現在非表示になっているスペースIDを重複なく集める */
  function collectHiddenCandidateIds(target) {
    var widget = document.querySelector(target.widget);
    if (!widget) {
      return [];
    }
    var ids = {};
    Array.prototype.forEach.call(widget.querySelectorAll(target.item), function (item) {
      var row = item.closest(target.row) || item;
      if (row.getAttribute(FILTERED_ATTR) !== 'true') {
        return;
      }
      var spaceId = extractSpaceId(item);
      if (spaceId !== null) {
        ids[spaceId] = true;
      }
    });
    return Object.keys(ids);
  }

  /** 指定スペースIDの行をすべて表示に戻す */
  function showRowsForSpaceId(target, spaceId) {
    var widget = document.querySelector(target.widget);
    if (!widget) {
      return;
    }
    Array.prototype.forEach.call(widget.querySelectorAll(target.item), function (item) {
      if (extractSpaceId(item) !== spaceId) {
        return;
      }
      var row = item.closest(target.row) || item;
      showRow(row);
    });
    refreshWidgetVisibility(target);
  }

  /**
   * 非表示候補（ホワイトリスト外・鍵なし・DOM上で参加済みと判定できなかったもの）
   * だけに絞って、参加済みかどうかを API で確認する。
   * 呼び出しはスペースIDごとに一度きり（キャッシュ・進行中フラグで重複を防ぐ）。
   */
  function checkMembershipForCandidates(target) {
    if (!target.checkMembershipApi) {
      return;
    }
    collectHiddenCandidateIds(target).forEach(function (spaceId) {
      if (membershipRequested[spaceId]) {
        return;
      }

      var cached = readJoinCache(spaceId);
      if (cached === 'yes') {
        membershipRequested[spaceId] = true;
        showRowsForSpaceId(target, spaceId);
        return;
      }
      if (cached === 'no') {
        membershipRequested[spaceId] = true;
        return;
      }

      membershipRequested[spaceId] = true;
      checkMembership(spaceId)
        .then(function (joined) {
          writeJoinCache(spaceId, joined ? 'yes' : 'no');
          if (joined) {
            showRowsForSpaceId(target, spaceId);
          }
          log(target.name, 'メンバーシップ確認', spaceId, joined ? '参加済み→表示' : '未参加→非表示のまま');
        })
        .catch(function (error) {
          // 確認できない場合は非表示のまま（フェイルセーフ）。キャッシュはせず次回また確認を試みる
          membershipRequested[spaceId] = false;
          warn('メンバーシップ確認に失敗しました', spaceId, error);
        });
    });
  }

  // ------------------------------------------------------------
  // エントリーポイント
  // ------------------------------------------------------------

  function safeRun(target) {
    try {
      preHide();
      applyWithRetry(target, RETRY_MAX);
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
