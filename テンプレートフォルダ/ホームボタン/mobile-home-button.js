(function() {
    "use strict";

    // 表示するイベント（一覧、詳細、スペース）
    var events = [
        'mobile.app.record.index.show',
        'mobile.app.record.detail.show',
        'mobile.space.portal.show'
    ];

    kintone.events.on(events, function(event) {
        setupHomeButton();
        return event;
    });

    // ボタンの無条件マウント。
    // Kintoneはモバイルの「スレッド個別表示」等に対応するJSカスタマイズイベントを提供して
    // いないため、kintone.events.on(events, ...) だけではその画面でボタンが一度もマウント
    // されない。setupHomeButton() は重複防止ガードを持つため、スクリプト読み込み時に無条件で
    // 呼んでも他画面での二重生成は起きず、どの画面でも確実にボタンを表示できる。
    setupHomeButton();

    function setupHomeButton() {
        // 重複防止
        if (document.getElementById('mobile-home-shortcut')) {
            return;
        }

        // ホームボタン（リンク）を作成
        var homeBtn = document.createElement('a');
        homeBtn.id = 'mobile-home-shortcut';
        homeBtn.href = '/k/m/'; // モバイル版ポータルURL

        // ★モダンな家のアイコン（SVG）を埋め込み
        homeBtn.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z" fill="white"/>
            </svg>
        `;

        // ▼ デザイン設定
        var s = homeBtn.style;
        s.position = 'fixed';
        s.bottom = '16px';          // 少し上に配置（視認性向上）
        s.left = '50%';
        s.transform = 'translateX(-50%)';

        s.width = '56px';           // 指で押しやすいサイズ（標準的なFABサイズ）
        s.height = '56px';
        s.borderRadius = '50%';     // 完全な丸

        // ★グラデーション背景（ポータルの青系に合わせる）
        s.background = 'linear-gradient(135deg, #2b7bc0 0%, #154260 100%)';

        s.display = 'flex';
        s.justifyContent = 'center';
        s.alignItems = 'center';

        // ★リッチな影（浮遊感）
        s.boxShadow = '0 4px 12px rgba(21, 66, 96, 0.4)';
        s.zIndex = '9999';

        // タップ時のフィードバック（少し凹むアニメーション）
        s.transition = 'transform 0.1s ease';
        homeBtn.ontouchstart = function() {
            s.transform = 'translateX(-50%) scale(0.95)';
        };
        homeBtn.ontouchend = function() {
            s.transform = 'translateX(-50%) scale(1)';
        };

        // 画面に追加
        document.body.appendChild(homeBtn);
    }
})();
