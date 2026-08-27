/**
 * profile-restriction-plugin / config.js
 * プラグイン設定画面のロジック
 */
(function ($, PLUGIN_ID) {
  'use strict';

  var config = kintone.plugin.app.getConfig(PLUGIN_ID);

  // ---- 初期値の読み込み ----

  var savedOrgs = config.orgs ? JSON.parse(config.orgs) : ['共通管理者'];
  var savedGroups = config.groups ? JSON.parse(config.groups) : ['デジタル委員会'];
  var savedMessage = config.message || 'このプロフィールは閲覧できません。';

  // ---- 入力行の動的追加・削除 ----

  function createRow(value, containerId) {
    var row = document.createElement('div');
    row.className = 'config-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'config-input';
    input.value = value;
    input.placeholder = containerId === 'org-list' ? '組織コードを入力' : 'グループコードを入力';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'config-btn-delete';
    btn.textContent = '削除';
    btn.addEventListener('click', function () {
      var container = document.getElementById(containerId);
      if (container.querySelectorAll('.config-row').length > 1) {
        row.parentNode.removeChild(row);
      } else {
        alert('少なくとも1件は残してください。すべて制限したい場合は存在しないコードを入力してください。');
      }
    });

    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  function renderList(containerId, values) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    values.forEach(function (v) {
      container.appendChild(createRow(v, containerId));
    });
  }

  function getValues(containerId) {
    var inputs = document.querySelectorAll('#' + containerId + ' .config-input');
    return Array.prototype.map.call(inputs, function (i) { return i.value.trim(); }).filter(Boolean);
  }

  // ---- DOMContentLoaded ----

  document.addEventListener('DOMContentLoaded', function () {
    renderList('org-list', savedOrgs);
    renderList('group-list', savedGroups);
    document.getElementById('message-input').value = savedMessage;

    // 追加ボタン
    document.getElementById('btn-add-org').addEventListener('click', function () {
      document.getElementById('org-list').appendChild(createRow('', 'org-list'));
    });

    document.getElementById('btn-add-group').addEventListener('click', function () {
      document.getElementById('group-list').appendChild(createRow('', 'group-list'));
    });

    // 保存ボタン
    document.getElementById('btn-save').addEventListener('click', function () {
      var orgs = getValues('org-list');
      var groups = getValues('group-list');
      var message = document.getElementById('message-input').value.trim();

      if (orgs.length === 0 && groups.length === 0) {
        alert('許可する組織コードまたはグループコードを少なくとも1件入力してください。');
        return;
      }
      if (!message) {
        alert('閲覧不可時のメッセージを入力してください。');
        return;
      }

      kintone.plugin.app.setConfig(
        {
          orgs: JSON.stringify(orgs),
          groups: JSON.stringify(groups),
          message: message,
        },
        function () {
          alert('設定を保存しました。');
          window.location.href = '/k/admin/plugin/';
        }
      );
    });

    // キャンセルボタン
    document.getElementById('btn-cancel').addEventListener('click', function () {
      window.location.href = '/k/admin/plugin/';
    });
  });
})(jQuery, kintone.$PLUGIN_ID);
