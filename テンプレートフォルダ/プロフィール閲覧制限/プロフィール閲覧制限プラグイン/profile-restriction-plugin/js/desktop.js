/**
 * profile-restriction-plugin / desktop.js
 * Web版エントリーポイント
 */
(function () {
  'use strict';

  // ページ読み込み完了後に実行
  kintone.events.on([
    'app.record.index.show',
    'app.record.detail.show',
    'portal.show',
    'space.portal.show',
  ], function (event) {
    ProfileRestrictionPlugin.restrictUserLinks();
    return event;
  });

  // プロフィールページはKintoneイベントが発火しないため DOMContentLoaded で対応
  document.addEventListener('DOMContentLoaded', function () {
    ProfileRestrictionPlugin.restrictProfilePage();
    ProfileRestrictionPlugin.restrictUserLinks();
  });
})();
