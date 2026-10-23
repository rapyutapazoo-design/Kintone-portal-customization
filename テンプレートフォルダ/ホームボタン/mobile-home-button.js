(function() {
    "use strict";

    // 表示するイベント（一覧、詳細、スペース）
    var events = [
        'mobile.app.record.index.show',
        'mobile.app.record.detail.show',
        'mobile.space.portal.show'
    ];

    var TAP_STYLE_ID = 'mobile-home-button-tap-style';
    var MIN_PRESS_MS = 120;
    var NAV_FAILSAFE_MS = 10000;

    // 戻る操作（bfcache）で復元されたとき、遷移中表示が残らないようにする
    window.addEventListener('pageshow', resetTapStates);

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
        // 画面再表示でも遷移中表示を残さない（重複防止の早期returnより前で行う）
        resetTapStates();
        injectTapStyle();

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
        s.left = 'calc(50% - 28px)'; // 中央寄せ（幅56px）。transform はタップ演出と競合するため使わない

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

        // タップ演出（リップル＋遷移中の進捗バー）
        homeBtn.className = 'mhb-tap';
        attachTapFeedback(homeBtn, true);

        // 画面に追加
        document.body.appendChild(homeBtn);
    }

    // ============================================================
    // タップ演出: <style> 注入
    // ============================================================
    /**
     * タップ演出（リップル＋遷移中の進捗バー）用の <style> を一度だけ注入する。
     * 押下・遷移中の見た目はクラス（mhb-tap と状態クラス）で切り替えるため、
     * インラインstyleとぶつかるプロパティ（transition/transform 等）は付与側で外してある。
     */
    function injectTapStyle() {
        if (document.getElementById(TAP_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = TAP_STYLE_ID;
        style.textContent =
            '.mhb-tap{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;overflow:hidden;isolation:isolate;cursor:pointer;transition:filter 150ms ease, background-color 150ms ease;}' +
            '.mhb-tap:focus:not(:focus-visible){outline:none;}' +
            '.mhb-tap:focus-visible{outline:2px solid #154260;outline-offset:2px;}' +
            '.mhb-tap::before{content:"";position:absolute;z-index:0;pointer-events:none;left:var(--mhb-rx,50%);top:var(--mhb-ry,50%);width:var(--mhb-rd,200px);height:var(--mhb-rd,200px);margin:calc(var(--mhb-rd,200px) / -2) 0 0 calc(var(--mhb-rd,200px) / -2);border-radius:50%;background:rgba(255,255,255,.32);transform:scale(0);opacity:0;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 350ms ease;}' +
            '.mhb-tap.is-pressed::before{transform:scale(1);opacity:1;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 60ms;}' +
            '.mhb-tap.is-navigating::before{transform:scale(1);opacity:.55;}' +
            '.mhb-tap.is-navigating::after{content:"";position:absolute;z-index:1;pointer-events:none;left:30%;bottom:10px;height:3px;width:40%;background:rgba(255,255,255,.9);border-radius:3px;animation:mhb-tap-bar-home 1s ease-in-out infinite;}' +
            '.mhb-tap svg{position:relative;z-index:1;}' +
            '@keyframes mhb-tap-bar-home{0%,100%{transform:scaleX(.3)}50%{transform:scaleX(1)}}' +
            '@media (hover:hover) and (pointer:fine){.mhb-tap:hover{filter:brightness(1.1);}}' +
            '@media (prefers-reduced-motion: reduce){.mhb-tap{transition:none;}.mhb-tap::before{display:none;}.mhb-tap.is-pressed{filter:brightness(.88);}.mhb-tap.is-navigating::after{animation:none;transform:none;}}';
        document.head.appendChild(style);
    }

    // ============================================================
    // タップ演出: 押下コントローラー
    // ============================================================
    /**
     * 通常のクリック（左ボタン・修飾キーなし）かどうか。
     * ctrl/cmd/shift/alt 付きは新規タブ等のブラウザ標準動作なので、遷移中表示にしない。
     */
    function isPlainActivation(e) {
        return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    }

    /**
     * 押下中・遷移中の状態を全要素から外す。
     * 戻る操作（bfcache）やSPA的な画面再表示で、遷移中表示が残ったままになるのを防ぐ。
     */
    function resetTapStates() {
        var els = document.querySelectorAll('.mhb-tap.is-pressed, .mhb-tap.is-navigating');
        for (var i = 0; i < els.length; i++) {
            els[i].classList.remove('is-pressed');
            els[i].classList.remove('is-navigating');
        }
    }

    /**
     * 要素にタップ演出（リップル＋遷移中の進捗バー）を付ける。
     * @param {HTMLElement} el 対象要素（className に mhb-tap を含めること）
     * @param {boolean} navigates クリックで画面遷移するなら true（遷移中の進捗バーを出す）
     */
    function attachTapFeedback(el, navigates) {
        var downAt = 0;
        var isDown = false;
        var pressTimer = null;
        var navTimer = null;

        // 一瞬のタップでも波紋が見えるよう、最低 MIN_PRESS_MS は表示を残すための残り時間
        function remaining() {
            return Math.max(0, MIN_PRESS_MS - (Date.now() - downAt));
        }

        // 波紋の中心（要素内座標）と、要素の四隅まで届く直径を CSS 変数で渡す
        function setOrigin(x, y) {
            var rect = el.getBoundingClientRect();
            var w = rect.width;
            var h = rect.height;
            var d = 2 * Math.sqrt(Math.pow(Math.max(x, w - x), 2) + Math.pow(Math.max(y, h - y), 2));
            el.style.setProperty('--mhb-rx', x + 'px');
            el.style.setProperty('--mhb-ry', y + 'px');
            el.style.setProperty('--mhb-rd', d + 'px');
        }

        function setCenter() {
            var rect = el.getBoundingClientRect();
            setOrigin(rect.width / 2, rect.height / 2);
        }

        function clearPress() {
            clearTimeout(pressTimer);
            isDown = false;
            el.classList.remove('is-pressed');
        }

        // キーボード操作など、押下イベントを伴わない場合に中心から短く波紋を出す
        function flashPress() {
            setCenter();
            el.classList.add('is-pressed');
            clearTimeout(pressTimer);
            pressTimer = setTimeout(function () {
                el.classList.remove('is-pressed');
            }, MIN_PRESS_MS);
        }

        el.addEventListener('pointerdown', function (e) {
            if (!e.isPrimary || e.button !== 0) return;
            if (el.classList.contains('is-navigating')) return;
            clearTimeout(pressTimer);
            var rect = el.getBoundingClientRect();
            setOrigin(e.clientX - rect.left, e.clientY - rect.top);
            downAt = Date.now();
            isDown = true;
            el.classList.add('is-pressed');
        });

        el.addEventListener('pointerup', function () {
            if (!isDown) return;
            isDown = false;
            pressTimer = setTimeout(function () {
                el.classList.remove('is-pressed');
            }, remaining());
        });

        el.addEventListener('pointercancel', clearPress);

        // タッチでは pointerup の後にも pointerleave が来るため、押している間だけ取り消しにする
        el.addEventListener('pointerleave', function () {
            if (isDown) clearPress();
        });

        el.addEventListener('click', function (e) {
            if (el.classList.contains('is-navigating')) return;
            if (!navigates || !isPlainActivation(e)) {
                if (!el.classList.contains('is-pressed')) flashPress();
                return;
            }
            if (!el.classList.contains('is-pressed')) setCenter();
            clearTimeout(pressTimer);
            el.classList.remove('is-pressed');
            el.classList.add('is-navigating');
            // 遷移が起きなかった場合に備えたフェイルセーフ
            clearTimeout(navTimer);
            navTimer = setTimeout(function () {
                el.classList.remove('is-navigating');
            }, NAV_FAILSAFE_MS);
        });
    }
})();
