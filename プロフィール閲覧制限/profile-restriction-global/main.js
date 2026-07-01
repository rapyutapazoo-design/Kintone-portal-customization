/**
 * プロフィール閲覧制限 / main.js
 * 全体カスタマイズとして全画面に適用されるメインロジック。
 * config-loader.js より後に読み込んでください。
 */
(function () {
  'use strict';

  // ---- セレクタ定数（Kintoneのバージョンアップで変わった場合はここを修正） ----
  var PROFILE_PATH = '/k/user/profile';
  var PROFILE_CONTENT_SELECTORS = [
    '.gaia-body-inner',
    '[class*="profile-contents"]',
    '[class*="userProfile"]',
  ];
  var USER_LINK_RE = /\/k\/user\/profile/;
  var PERMISSION_CACHE_KEY = 'profile_restriction_permitted';

  // ---- ログインユーザー情報 ----
  function getLoginUser() {
    return kintone.getLoginUser();
  }

  // ---- プロフィールページの表示対象ユーザーコードを取得 ----
  // URL例: /k/user/profile/?user=yamada
  function getProfileUserCode() {
    var match = location.search.match(/[?&]user=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // ---- 許可判定（sessionStorageキャッシュ付き） ----
  function checkPermission(config) {
    var cached = sessionStorage.getItem(PERMISSION_CACHE_KEY);
    if (cached !== null) {
      return Promise.resolve(cached === '1');
    }

    var userCode = getLoginUser().code;
    var orgPromise = kintone.api(
      kintone.api.url('/k/v1/user/organizations', true), 'GET', { code: userCode }
    );
    var groupPromise = kintone.api(
      kintone.api.url('/k/v1/user/groups', true), 'GET', { code: userCode }
    );

    return Promise.all([orgPromise, groupPromise]).then(function (results) {
      var orgCodes = results[0].organizationTitles.map(function (o) { return o.organization.code; });
      var groupCodes = results[1].groups.map(function (g) { return g.code; });

      var permitted =
        config.orgs.some(function (c) { return orgCodes.indexOf(c) !== -1; }) ||
        config.groups.some(function (c) { return groupCodes.indexOf(c) !== -1; });

      sessionStorage.setItem(PERMISSION_CACHE_KEY, permitted ? '1' : '0');
      return permitted;
    }).catch(function () {
      // 判定失敗時は安全側（非許可）
      return false;
    });
  }

  // ---- プロフィールページの表示制御 ----
  function showProfile() {
    var overlay = document.getElementById('profile-restriction-overlay');
    if (overlay) overlay.parentNode.removeChild(overlay);
    document.documentElement.classList.add('profile-restriction-allowed');
  }

  function blockProfile(message) {
    document.documentElement.classList.add('profile-restriction-blocked');
    if (!document.getElementById('profile-restriction-overlay')) {
      var overlay = document.createElement('div');
      overlay.id = 'profile-restriction-overlay';
      overlay.className = 'profile-restriction-overlay';
      overlay.textContent = message;
      document.body.appendChild(overlay);
    }
  }

  function restrictProfilePage(config) {
    if (location.pathname.indexOf(PROFILE_PATH) === -1) return;

    var loginUser = getLoginUser();
    var profileUserCode = getProfileUserCode();

    // 自分自身は常に表示
    if (profileUserCode && profileUserCode === loginUser.code) {
      showProfile();
      return;
    }

    checkPermission(config).then(function (permitted) {
      permitted ? showProfile() : blockProfile(config.message);
    });
  }

  // ---- ユーザー名リンクの無効化 ----
  function disableUserLinks() {
    var links = document.querySelectorAll('a[href]');
    links.forEach(function (a) {
      if (USER_LINK_RE.test(a.getAttribute('href'))) {
        var span = document.createElement('span');
        span.className = 'profile-restriction-username';
        span.textContent = a.textContent;
        a.parentNode.replaceChild(span, a);
      }
    });
  }

  function observeAndDisableLinks() {
    disableUserLinks();
    var observer = new MutationObserver(disableUserLinks);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function restrictUserLinks(config) {
    // プロフィールページ上では不要
    if (location.pathname.indexOf(PROFILE_PATH) !== -1) return;

    checkPermission(config).then(function (permitted) {
      if (!permitted) observeAndDisableLinks();
    });
  }

  // ---- メイン処理 ----
  function init() {
    ProfileRestrictionConfig.load().then(function (config) {
      restrictProfilePage(config);
      restrictUserLinks(config);
    });
  }

  // Kintoneイベント（アプリ画面・ポータル・スペース）
  var events = [
    'app.record.index.show',
    'app.record.detail.show',
    'portal.show',
    'space.portal.show',
    'mobile.app.record.index.show',
    'mobile.app.record.detail.show',
    'mobile.portal.show',
    'mobile.space.portal.show',
  ];

  kintone.events.on(events, function (event) {
    init();
    return event;
  });

  // プロフィールページはKintoneイベントが発火しないためDOMContentLoadedで対応
  document.addEventListener('DOMContentLoaded', function () {
    // kintoneオブジェクトが使える環境かを確認してから実行
    if (typeof kintone !== 'undefined' && typeof ProfileRestrictionConfig !== 'undefined') {
      init();
    }
  });
})();
