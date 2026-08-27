/**
 * profile-restriction-plugin / common.js
 * Web版・モバイル版で共有するユーティリティ
 */
(function (PLUGIN_ID) {
  'use strict';

  var CACHE_KEY = 'profile_restriction_permitted_' + PLUGIN_ID;

  // ---- 設定値の取得 ----

  function getConfig() {
    var config = kintone.plugin.app.getConfig(PLUGIN_ID);
    return {
      orgs: config.orgs ? JSON.parse(config.orgs) : [],
      groups: config.groups ? JSON.parse(config.groups) : [],
      message: config.message || 'このプロフィールは閲覧できません。',
    };
  }

  // ---- ログインユーザー情報 ----

  function getLoginUser() {
    return kintone.getLoginUser();
  }

  // ---- プロフィールページのユーザーコード取得 ----
  // URL例: /k/user/profile/?user=yamada
  function getProfileUserCode() {
    var match = location.search.match(/[?&]user=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // ---- 許可判定（sessionStorageキャッシュ付き） ----

  function checkPermission(config) {
    // キャッシュ確認
    var cached = sessionStorage.getItem(CACHE_KEY);
    if (cached !== null) {
      return Promise.resolve(cached === '1');
    }

    var loginUser = getLoginUser();
    var userCode = loginUser.code;

    var orgPromise = kintone.api(kintone.api.url('/k/v1/user/organizations', true), 'GET', { code: userCode });
    var groupPromise = kintone.api(kintone.api.url('/k/v1/user/groups', true), 'GET', { code: userCode });

    return Promise.all([orgPromise, groupPromise]).then(function (results) {
      var orgCodes = results[0].organizationTitles.map(function (o) { return o.organization.code; });
      var groupCodes = results[1].groups.map(function (g) { return g.code; });

      var permitted =
        config.orgs.some(function (c) { return orgCodes.indexOf(c) !== -1; }) ||
        config.groups.some(function (c) { return groupCodes.indexOf(c) !== -1; });

      sessionStorage.setItem(CACHE_KEY, permitted ? '1' : '0');
      return permitted;
    });
  }

  // ---- プロフィールページの制御 ----

  function restrictProfilePage() {
    // プロフィールページ以外は何もしない
    if (location.pathname.indexOf('/k/user/profile') === -1) {
      return;
    }

    var config = getConfig();
    var loginUser = getLoginUser();
    var profileUserCode = getProfileUserCode();

    // 自分自身のプロフィールは常に表示
    if (profileUserCode && profileUserCode === loginUser.code) {
      showProfile();
      return;
    }

    checkPermission(config).then(function (permitted) {
      if (permitted) {
        showProfile();
      } else {
        blockProfile(config.message);
      }
    }).catch(function () {
      // API失敗時は安全側に倒して非表示
      blockProfile(config.message);
    });
  }

  function showProfile() {
    var el = document.getElementById('profile-restriction-overlay');
    if (el) el.parentNode.removeChild(el);
    document.documentElement.classList.add('profile-restriction-allowed');
  }

  function blockProfile(message) {
    document.documentElement.classList.add('profile-restriction-blocked');
    var overlay = document.getElementById('profile-restriction-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'profile-restriction-overlay';
      overlay.className = 'profile-restriction-overlay';
      overlay.textContent = message;
      document.body.appendChild(overlay);
    }
  }

  // ---- ユーザー名リンクの無効化 ----
  // 非許可ユーザーのみ: <a href="/k/user/..."> → <span> に変換（名前テキストは保持）

  var USER_LINK_RE = /\/k\/user\/profile/;

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
    var observer = new MutationObserver(function () {
      disableUserLinks();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function restrictUserLinks() {
    // プロフィールページでは不要
    if (location.pathname.indexOf('/k/user/profile') !== -1) return;

    var config = getConfig();
    var loginUser = getLoginUser();

    // 自分自身は許可（リンク無効化不要）の判定はキャッシュで高速化
    checkPermission(config).then(function (permitted) {
      if (!permitted) {
        observeAndDisableLinks();
      }
    }).catch(function () {
      observeAndDisableLinks();
    });
  }

  // ---- 公開インターフェース ----

  window.ProfileRestrictionPlugin = {
    restrictProfilePage: restrictProfilePage,
    restrictUserLinks: restrictUserLinks,
  };

})(kintone.$PLUGIN_ID);
