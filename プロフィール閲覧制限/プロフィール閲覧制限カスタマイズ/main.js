/**
 * プロフィール閲覧制限カスタマイズ / main.js
 * config.js より後に読み込んでください。
 */
(function () {
  'use strict';

  var settings = window.ProfileRestrictionSettings;
  if (!settings) return;

  var PROFILE_PATH = '/k/user/profile';
  // プロフィールリンクの実際のhref形式: /users/メールアドレス
  var USER_LINK_RE = /^\/users\//;

  // ログインユーザーのコードを取得（取得できない画面では null）
  function getLoginUserCode() {
    try {
      var u = kintone.getLoginUser();
      return u && u.code ? u.code : null;
    } catch (e) {
      return null;
    }
  }

  // 許可判定キャッシュは localStorage に保存し、全タブで共有する（別タブで開く
  // プロフィール詳細ページでも判定を読み取れる）。
  //  - config.version : 設定/ロジック更新時に古いキャッシュを自動無効化
  //  - ログインユーザーcode : ユーザー単位で判定を分離（他ユーザーの結果を流用しない）
  // getLoginUser() が取得できない場合は null を返し、キャッシュを使わせない。
  function getPermissionCacheKey() {
    var code = getLoginUserCode();
    if (!code) return null;
    return 'profile_restriction_permitted_v' + (settings.version || 1) + '__' + code;
  }

  // ---- ポップアップ関連セレクタ定数 ----
  // 開発者ツールで確認した ocean-ui クラス名
  var POPUP_PROFILE_LINK_CLASS = 'ocean-ui-userinfo-popup-info-profilelink';

  // プロフィールページなら JS実行と同時に即時非表示（ちらつき防止）。
  // ただし localStorage キャッシュで「許可済み」と分かっている場合は隠さない
  // （許可ユーザーのちらつきをなくす）。
  if (location.pathname.indexOf(PROFILE_PATH) !== -1) {
    var preKey = getPermissionCacheKey();
    if (!preKey || localStorage.getItem(preKey) !== '1') {
      document.documentElement.classList.add('profile-restriction-checking');
    }
  }

  // ---- 許可判定 ----
  // REST APIではなく kintone.user.getOrganizations() / kintone.user.getGroups() を使用
  // （全体カスタマイズ環境で確実に動作する公式JS API）
  function checkPermission() {
    var cacheKey = getPermissionCacheKey();

    if (cacheKey) {
      var cached = localStorage.getItem(cacheKey);
      if (cached !== null) return Promise.resolve(cached === '1');
    }

    // プロフィール詳細ページ（別タブ・/users/...）など kintone.user API が
    // 使えない画面では、判定できないため安全側（非許可）に倒す。
    // 通常はアプリ・ポータル画面で判定済みのキャッシュが localStorage 経由で
    // 共有されるため、ここに到達するのは初回直接アクセス時のみ。
    if (!kintone.user || typeof kintone.user.getOrganizations !== 'function') {
      return Promise.resolve(false);
    }

    return Promise.all([
      kintone.user.getOrganizations(),
      kintone.user.getGroups(),
    ]).then(function (results) {
      // getOrganizations() → [{organization: {code, name, ...}, title}, ...]
      // getGroups()        → [{id, code, name}, ...]
      // コードと名前の両方を照合対象に集める（設定値がどちらでも一致するように）
      var orgValues = [];
      results[0].forEach(function (o) {
        if (o.organization) {
          orgValues.push(o.organization.code, o.organization.name);
        }
      });
      var groupValues = [];
      results[1].forEach(function (g) {
        groupValues.push(g.code, g.name);
      });

      var permitted =
        settings.allowedOrgs.some(function (v) { return orgValues.indexOf(v) !== -1; }) ||
        settings.allowedGroups.some(function (v) { return groupValues.indexOf(v) !== -1; });

      if (cacheKey) localStorage.setItem(cacheKey, permitted ? '1' : '0');
      return permitted;
    }).catch(function () {
      return false; // 判定失敗時は安全側（非許可）
    });
  }

  // ---- プロフィールページ制御 ----
  function showProfile() {
    var el = document.getElementById('profile-restriction-overlay');
    if (el) el.parentNode.removeChild(el);
    var cl = document.documentElement.classList;
    cl.remove('profile-restriction-checking');
    cl.remove('profile-restriction-blocked');
    cl.add('profile-restriction-allowed');
  }

  function blockProfile() {
    var cl = document.documentElement.classList;
    cl.remove('profile-restriction-checking');
    cl.remove('profile-restriction-allowed');
    cl.add('profile-restriction-blocked');
    if (document.getElementById('profile-restriction-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'profile-restriction-overlay';
    overlay.className = 'profile-restriction-overlay';
    overlay.textContent = settings.blockMessage;
    document.body.appendChild(overlay);
  }

  function handleProfilePage() {
    if (location.pathname.indexOf(PROFILE_PATH) === -1) return;

    var loginUser = kintone.getLoginUser();
    var match = location.search.match(/[?&]user=([^&]+)/);
    var profileUserCode = match ? decodeURIComponent(match[1]) : null;

    // 自分自身のプロフィールは常に表示
    if (profileUserCode && profileUserCode === loginUser.code) {
      showProfile();
      return;
    }

    checkPermission().then(function (permitted) {
      permitted ? showProfile() : blockProfile();
    });
  }

  // ---- ユーザー名リンクの無効化 ----
  function disableUserLinks() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (!USER_LINK_RE.test(a.getAttribute('href'))) return;
      var span = document.createElement('span');
      span.className = 'profile-restriction-username';
      span.textContent = a.textContent;
      a.parentNode.replaceChild(span, a);
    });
  }

  // ---- ポップアップの「プロフィール詳細」リンクへのクリックをキャプチャで遮断（第2層） ----
  function blockPopupProfileLinkClick() {
    document.addEventListener('click', function (e) {
      // クリックされた要素またはその祖先に profilelink クラスがあればブロック
      var el = e.target;
      while (el && el !== document) {
        if (el.classList && el.classList.contains(POPUP_PROFILE_LINK_CLASS)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        el = el.parentNode;
      }
    }, true); // キャプチャフェーズで登録
  }

  function handleUserLinks() {
    if (location.pathname.indexOf(PROFILE_PATH) !== -1) return;
    checkPermission().then(function (permitted) {
      if (!permitted) {
        disableUserLinks();
        new MutationObserver(disableUserLinks).observe(document.body, { childList: true, subtree: true });
        blockPopupProfileLinkClick();
      }
    });
  }

  // ---- エントリーポイント ----
  function init() {
    handleProfilePage();
    handleUserLinks();
  }

  // Kintoneイベント（アプリ・ポータル・スペース）
  kintone.events.on([
    'app.record.index.show',
    'app.record.detail.show',
    'portal.show',
    'space.portal.show',
    'mobile.app.record.index.show',
    'mobile.app.record.detail.show',
    'mobile.portal.show',
    'mobile.space.portal.show',
  ], function (event) {
    init();
    return event;
  });

  // プロフィールページはKintoneイベントが発火しない。
  // 全体カスタマイズJSはDOMContentLoaded後に実行されるため、
  // readyStateを確認してから即時実行またはリスナー登録する。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
