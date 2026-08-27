/**
 * スペースの参加・退会ボタン
 * ------------------------------------------------------------
 * スペースのトップ画面に「参加する」「退会する」ボタンを表示します。
 * Kintone 標準では、参加・退会は右上の「…」オプションメニューを開かないと
 * 現れないため気づきにくく、参加したつもりで参加できていない状態が起きます。
 * このカスタマイズは、その操作をトップ画面のボタン1つに集約します。
 *
 * ボタンは自分の参加状況に応じて 3 通りに変化します:
 *   - 非メンバー          → 「このスペースに参加する」（押せる）
 *   - 明示的メンバー      → 「このスペースを退会する」（押せる）
 *   - 暗黙的メンバー      → ボタンを表示しない
 *   - 状態を判定できない  → ボタンを表示しない（安全側に倒す）
 *
 * 「暗黙的メンバー」とは:
 *   所属する組織やグループ（everyone を含む）がスペースのメンバーになっているため、
 *   間接的にメンバー扱いになっている状態です（members.json の isImplicit: true）。
 *   この場合 Kintone 自身も参加・退会の手段を提供しておらず、退会という概念が
 *   存在しません。押しても失敗するボタンを出さないため、表示対象から除外します。
 *
 * 実装方針:
 *   参加・退会は Kintone 本体が使っている内部エンドポイントを呼び出します。
 *     POST /k/api/space/join.json  { spaceId, __REQUEST_TOKEN__ }
 *     POST /k/api/space/leave.json { spaceId, __REQUEST_TOKEN__ }
 *   REST API の PUT /k/v1/space/members.json は「メンバー一覧の全件置換」であり、
 *   スペース管理者権限が必要かつ同時更新で他の人の変更を消す危険があるため使いません。
 *   上記エンドポイントは自分 1 人の参加・退会だけを行うため、その危険がありません。
 *
 *   モバイル版には Kintone 標準の参加・退会 UI がそもそも存在しないため、
 *   PC・モバイルで同じエンドポイントを使い、挙動を揃えています。
 *
 * 適用先: cybozu.com 共通管理 → JavaScript / CSS カスタマイズ（PC 用・モバイル用の両方に設定）
 */
(function () {
  'use strict';

  // ============================================================
  // 設定（運用時はこのブロックだけを編集してください）
  // ============================================================
  var CONFIG = {
    // ボタンを表示しないスペース ID。全スペースに出す場合は空のままにします。
    EXCLUDE_SPACE_IDS: [],

    // 退会ボタンを表示するか。false にすると参加ボタンのみになります
    // （いったん参加したら抜けさせない運用にしたい場合に false）。
    SHOW_LEAVE_BUTTON: true,

    // 退会時に確認ダイアログを出すか
    CONFIRM_ON_LEAVE: true,

    // ボタンのラベル
    JOIN_LABEL: '＋ このスペースに参加する',
    LEAVE_LABEL: 'このスペースを退会する',

    // true にするとブラウザのコンソールに判定結果を出力します（調査用）
    DEBUG: false
  };

  // ============================================================
  // 以下は通常編集不要
  // ============================================================

  var LOG_PREFIX = '[space-join-button]';
  var BUTTON_ID = 'space-join-button';
  var STYLE_ID = 'space-join-button-style';
  var RETRY_INTERVAL_MS = 150;
  var RETRY_MAX = 30;

  // 実行ごとに増やす世代番号。スペースを続けて開いたときに、
  // 前のスペースの非同期処理が後から返ってきて割り込むのを防ぐ。
  // （参加・退会は状態を変える操作のため、誤ったスペースのボタンを
  //   描画してしまうと実害が出る）
  var runToken = 0;

  /** 画面種別ごとの DOM セレクタ（2026-08 時点の Kintone で実機確認済み） */
  var TARGETS = {
    desktop: {
      name: 'desktop',
      // カバー画像の直下にある空のツールバー領域。ここに入れると
      // コンテンツを押し下げる形で収まり、既存の表示に重ならない。
      // （スペース名の入れ物はカバー内で高さが固定されており、はみ出す）
      anchor: 'div.gaia-argoui-space-spacelayout-toolbar',
      insert: 'append',
      variant: 'desktop'
    },
    mobile: {
      name: 'mobile',
      // モバイルはスペースヘッダーの直後に置く
      anchor: 'div.gaia-mobile-v2-space-spaceheader',
      insert: 'after',
      variant: 'mobile'
    }
  };

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
  // スペース ID の取得
  // ------------------------------------------------------------

  /** URL からスペース ID を取り出す（PC: /k/#/space/3 、モバイル: /k/m/space/3） */
  function currentSpaceId() {
    var matched = (location.href || '').match(/\/space\/(\d+)/);
    return matched ? matched[1] : null;
  }

  // ------------------------------------------------------------
  // 参加状態の判定
  // ------------------------------------------------------------

  var STATE = {
    NOT_MEMBER: 'notMember',   // 非メンバー → 参加ボタン
    EXPLICIT: 'explicit',      // 明示的メンバー → 退会ボタン
    IMPLICIT: 'implicit',      // 組織・グループ経由の暗黙的メンバー → ボタンなし
    UNKNOWN: 'unknown'         // 判定不能 → ボタンなし
  };

  /**
   * 自分の参加状態を調べる。
   * isImplicit を見ることで「自分で参加した明示的メンバー」と
   * 「組織・グループ経由の暗黙的メンバー」を区別できる。
   */
  function fetchMemberState(spaceId) {
    return kintone
      .api('/k/v1/space/members.json', 'GET', { id: spaceId })
      .then(function (resp) {
        var userCode = kintone.getLoginUser().code;
        var members = resp.members || [];
        var mine = null;
        members.some(function (member) {
          if (member && member.entity &&
              member.entity.type === 'USER' &&
              member.entity.code === userCode) {
            mine = member;
            return true;
          }
          return false;
        });
        if (!mine) {
          return STATE.NOT_MEMBER;
        }
        return mine.isImplicit ? STATE.IMPLICIT : STATE.EXPLICIT;
      })
      .catch(function (error) {
        // 権限が無い等で確認できない場合はボタンを出さない
        log('参加状態を判定できませんでした', spaceId, error);
        return STATE.UNKNOWN;
      });
  }

  // ------------------------------------------------------------
  // 参加・退会の実行
  // ------------------------------------------------------------

  /**
   * Kintone 本体が使っている内部エンドポイントを呼び出す。
   * kintone.api() は REST API 用のため使わず、fetch で直接呼ぶ。
   * CSRF 対策のトークンは kintone.getRequestToken() から取得する。
   */
  function postSpaceAction(action, spaceId) {
    var url = '/k/api/space/' + action + '.json';
    var payload = {
      spaceId: String(spaceId),
      __REQUEST_TOKEN__: kintone.getRequestToken()
    };
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      if (!resp.ok) {
        throw new Error(action + ' に失敗しました (HTTP ' + resp.status + ')');
      }
      return resp.text();
    }).then(function (text) {
      // このエンドポイントは HTTP 200 のまま本文の success で成否を返すため、
      // ステータスコードだけで成功と判断しない
      var parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error(action + ' の応答を解釈できませんでした');
      }
      if (parsed && parsed.success === false) {
        throw new Error(action + ' が拒否されました');
      }
      return parsed;
    });
  }

  // ------------------------------------------------------------
  // ボタンの描画
  // ------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + BUTTON_ID + '{',
      'display:inline-flex;align-items:center;justify-content:center;',
      'box-sizing:border-box;border:0;cursor:pointer;',
      'font-family:inherit;font-weight:bold;color:#fff;',
      'border-radius:20px;padding:9px 18px;font-size:13px;line-height:1.2;',
      'box-shadow:0 2px 6px rgba(0,0,0,0.2);transition:opacity .15s ease;',
      '}',
      '#' + BUTTON_ID + '[data-action="join"]{background:linear-gradient(135deg,#3498db 0%,#2874a6 100%);}',
      '#' + BUTTON_ID + '[data-action="leave"]{background:linear-gradient(135deg,#95a5a6 0%,#6d7b7c 100%);}',
      '#' + BUTTON_ID + ':hover{opacity:.85;}',
      '#' + BUTTON_ID + '[disabled]{opacity:.6;cursor:progress;}',
      // PC はカバー直下のツールバー内に、本文の左端と揃えて配置
      '#' + BUTTON_ID + '.space-join-button-desktop{margin:10px 0 6px 32px;}',
      // モバイルは横幅いっぱいに広げてタップしやすくする
      '#' + BUTTON_ID + '.space-join-button-mobile{display:flex;width:calc(100% - 24px);margin:8px 12px 12px;padding:12px 18px;font-size:14px;border-radius:24px;}',
      ''
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function removeButton() {
    var existing = document.getElementById(BUTTON_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  /**
   * @returns {boolean} 差し込み先が見つかって描画できたら true
   */
  function renderButton(target, spaceId, state, token) {
    var anchor = document.querySelector(target.anchor);
    if (!anchor) {
      return false;
    }

    removeButton();

    if (state !== STATE.NOT_MEMBER && state !== STATE.EXPLICIT) {
      // 暗黙的メンバー・判定不能はボタンを出さない
      log(target.name, spaceId, 'ボタン非表示 (state=' + state + ')');
      return true;
    }
    if (state === STATE.EXPLICIT && !CONFIG.SHOW_LEAVE_BUTTON) {
      log(target.name, spaceId, '退会ボタンは設定で無効');
      return true;
    }

    injectStyle();

    var isJoin = state === STATE.NOT_MEMBER;
    var button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'space-join-button-' + target.variant;
    button.setAttribute('data-action', isJoin ? 'join' : 'leave');
    button.textContent = isJoin ? CONFIG.JOIN_LABEL : CONFIG.LEAVE_LABEL;
    button.addEventListener('click', function () {
      handleClick(button, spaceId, isJoin, token);
    });

    if (target.insert === 'append') {
      anchor.appendChild(button);
    } else if (anchor.parentNode) {
      anchor.parentNode.insertBefore(button, anchor.nextSibling);
    } else {
      anchor.appendChild(button);
    }
    log(target.name, spaceId, isJoin ? '参加ボタンを表示' : '退会ボタンを表示');
    return true;
  }

  function handleClick(button, spaceId, isJoin, token) {
    if (button.disabled) {
      return;
    }
    // 参加・退会は状態を変える操作なので、押した瞬間に対象スペースを再確認する
    if (!isCurrent(token, spaceId)) {
      warn('表示中のスペースと対象が一致しないため操作を中止しました', spaceId);
      removeButton();
      return;
    }
    if (!isJoin && CONFIG.CONFIRM_ON_LEAVE) {
      if (!window.confirm('このスペースを退会します。よろしいですか？')) {
        return;
      }
    }

    button.disabled = true;
    button.textContent = isJoin ? '参加しています…' : '退会しています…';

    postSpaceAction(isJoin ? 'join' : 'leave', spaceId)
      .then(function () {
        // 参加・退会後は Kintone 側の表示（メンバー一覧・メニュー）も
        // 変わるため、画面全体を読み込み直して状態を揃える
        location.reload();
      })
      .catch(function (error) {
        warn(isJoin ? '参加' : '退会', 'に失敗しました', spaceId, error);
        button.disabled = false;
        button.textContent = isJoin ? CONFIG.JOIN_LABEL : CONFIG.LEAVE_LABEL;
        window.alert(
          (isJoin ? '参加' : '退会') + 'できませんでした。' +
          '時間をおいて再度お試しいただくか、デジタル委員会までお問い合わせください。'
        );
      });
  }

  // ------------------------------------------------------------
  // エントリーポイント
  // ------------------------------------------------------------

  /** この処理を始めたときのスペースを、今もまだ開いているか */
  function isCurrent(token, spaceId) {
    return token === runToken && currentSpaceId() === spaceId;
  }

  /** スペースヘッダーは遅延描画されるため、見つかるまで短い間隔で再試行する */
  function renderWithRetry(target, spaceId, state, remaining, token) {
    if (!isCurrent(token, spaceId)) {
      log(target.name, spaceId, '別のスペースに移動したため描画を中止');
      return;
    }
    if (renderButton(target, spaceId, state, token)) {
      return;
    }
    if (remaining <= 0) {
      log(target.name, 'ボタンの差し込み先が見つかりませんでした');
      return;
    }
    setTimeout(function () {
      renderWithRetry(target, spaceId, state, remaining - 1, token);
    }, RETRY_INTERVAL_MS);
  }

  function run(target) {
    var token = ++runToken;
    var spaceId = currentSpaceId();
    if (spaceId === null) {
      log('スペース ID を判定できませんでした');
      return;
    }
    if (CONFIG.EXCLUDE_SPACE_IDS.indexOf(spaceId) !== -1) {
      log(spaceId, '除外対象のスペースです');
      removeButton();
      return;
    }

    // 画面遷移で古いボタンが残らないように、状態確認の前に消しておく
    removeButton();

    fetchMemberState(spaceId).then(function (state) {
      renderWithRetry(target, spaceId, state, RETRY_MAX, token);
    });
  }

  function safeRun(target) {
    try {
      run(target);
    } catch (error) {
      // 何が起きても Kintone 標準の画面を壊さない
      removeButton();
      warn('処理中にエラーが発生したため、ボタンの表示を中止しました', error);
    }
  }

  kintone.events.on('space.portal.show', function (event) {
    safeRun(TARGETS.desktop);
    return event;
  });

  kintone.events.on('mobile.space.portal.show', function (event) {
    safeRun(TARGETS.mobile);
    return event;
  });
})();
