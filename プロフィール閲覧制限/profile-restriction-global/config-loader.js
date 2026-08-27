/**
 * プロフィール閲覧制限 / config-loader.js
 * 設定管理アプリから許可条件を取得し sessionStorage にキャッシュする。
 *
 * ★ 設定管理アプリのアプリIDをここに入力してください ★
 */
(function () {
  'use strict';

  // ----------------------------------------------------------------
  // ★ 変更が必要な設定値はここだけ ★
  // ----------------------------------------------------------------
  var CONFIG_APP_ID = 'YOUR_APP_ID'; // 設定管理アプリのアプリIDに書き換えてください
  // ----------------------------------------------------------------

  var CACHE_KEY = 'profile_restriction_config';

  /**
   * 設定管理アプリからレコード（1件目）を取得して返す。
   * キャッシュがあればAPIを叩かずに返す。
   * @returns {Promise<{orgs: string[], groups: string[], message: string}>}
   */
  function loadConfig() {
    var cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        return Promise.resolve(JSON.parse(cached));
      } catch (e) {
        sessionStorage.removeItem(CACHE_KEY);
      }
    }

    return kintone.api(
      kintone.api.url('/k/v1/records', true),
      'GET',
      { app: CONFIG_APP_ID, query: 'limit 1' }
    ).then(function (resp) {
      var record = resp.records[0];
      if (!record) {
        return { orgs: [], groups: [], message: 'このプロフィールは閲覧できません。' };
      }

      // フィールドコード: allowed_orgs / allowed_groups / block_message
      var orgs = (record.allowed_orgs.value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var groups = (record.allowed_groups.value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var message = (record.block_message.value || '').trim() || 'このプロフィールは閲覧できません。';

      var config = { orgs: orgs, groups: groups, message: message };
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(config));
      return config;
    }).catch(function () {
      // API失敗時はデフォルト値（閲覧不可）を返す
      return { orgs: [], groups: [], message: 'このプロフィールは閲覧できません。' };
    });
  }

  // グローバルに公開
  window.ProfileRestrictionConfig = { load: loadConfig };
})();
