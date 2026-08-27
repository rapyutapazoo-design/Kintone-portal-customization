/**
 * inquiry-button.js
 * ポータル画面の右上（configContainer の空きスペース）に
 * 「お問い合わせ（デジタル委員会宛て）」ボタンを設置する。
 *
 * 【依存関係】
 *   portal-shortcut.js が生成する共有コーディネーター window.PortalCustomize の
 *   configContainer（getConfigContainer()）にボタンを追加する。
 *   marginLeft: 'auto' により、configContainer 内の残り空間をすべて使って
 *   ボタンを行の右端（＝ポータル最上部の空きスペース）へ押し出す。
 *   → kintoneのJSカスタマイズ設定で、本ファイルは portal-shortcut.js より
 *     後ろに並べてください（順不同でも動くよう、下記でポーリング待機する）。
 */
(function () {
    "use strict";

    var INQUIRY_APP_ID = 'your-inquiry-app-id';
    var BUTTON_ID = 'inquiry-digital-committee-shortcut';
    var PORTAL_EVENTS = ['portal.show', 'mobile.portal.show'];
    var MAX_WAIT_MS = 5000;
    var POLL_INTERVAL_MS = 100;

    kintone.events.on(PORTAL_EVENTS, function (event) {
        mountButton();
        return event;
    });

    function mountButton() {
        if (document.getElementById(BUTTON_ID)) return;

        var waited = 0;
        var timer = setInterval(function () {
            waited += POLL_INTERVAL_MS;
            var config = window.PortalCustomize && window.PortalCustomize.getConfigContainer
                ? window.PortalCustomize.getConfigContainer()
                : null;

            if (config) {
                clearInterval(timer);
                if (!document.getElementById(BUTTON_ID)) {
                    config.appendChild(createButton());
                }
            } else if (waited >= MAX_WAIT_MS) {
                clearInterval(timer);
            }
        }, POLL_INTERVAL_MS);
    }

    function createButton() {
        var btn = document.createElement('a');
        btn.id = BUTTON_ID;
        btn.href = '/k/' + INQUIRY_APP_ID + '/';
        btn.textContent = '📩 お問い合わせ（デジタル委員会宛て）';

        var s = btn.style;
        s.marginLeft = 'auto';
        s.boxSizing = 'border-box';
        s.display = 'inline-flex';
        s.justifyContent = 'center';
        s.alignItems = 'center';
        s.whiteSpace = 'nowrap';
        s.padding = '10px 16px';
        s.borderRadius = '20px';
        s.background = 'linear-gradient(135deg, #d9534f 0%, #a92d2a 100%)';
        s.color = '#fff';
        s.border = 'none';
        s.fontWeight = 'bold';
        s.fontSize = '13px';
        s.letterSpacing = '0.5px';
        s.textDecoration = 'none';
        s.textShadow = '0 1px 2px rgba(0,0,0,0.2)';
        s.boxShadow = '0 4px 10px rgba(169, 45, 42, 0.4)';
        s.transition = 'all 0.3s ease';

        btn.onmouseover = function () {
            btn.style.transform = 'translateY(-3px)';
            btn.style.filter = 'brightness(1.1)';
        };
        btn.onmouseout = function () {
            btn.style.transform = 'translateY(0)';
            btn.style.filter = 'brightness(1)';
        };

        return btn;
    }
})();
