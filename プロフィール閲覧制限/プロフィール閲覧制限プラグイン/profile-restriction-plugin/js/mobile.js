/**
 * profile-restriction-plugin / mobile.js
 * モバイル版エントリーポイント
 */
(function () {
  'use strict';

  kintone.events.on([
    'mobile.app.record.index.show',
    'mobile.app.record.detail.show',
    'mobile.portal.show',
    'mobile.space.portal.show',
  ], function (event) {
    ProfileRestrictionPlugin.restrictUserLinks();
    return event;
  });

  document.addEventListener('DOMContentLoaded', function () {
    ProfileRestrictionPlugin.restrictProfilePage();
    ProfileRestrictionPlugin.restrictUserLinks();
  });
})();
