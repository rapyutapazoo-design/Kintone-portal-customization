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
    var TAP_STYLE_ID = 'inquiry-button-tap-style';
    var MIN_PRESS_MS = 120;
    var NAV_FAILSAFE_MS = 10000;

    // 戻る操作（bfcache）で復元されたとき、遷移中表示が残らないようにする
    window.addEventListener('pageshow', resetTapStates);

    kintone.events.on(PORTAL_EVENTS, function (event) {
        resetTapStates();
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
        injectTapStyle();

        var btn = document.createElement('a');
        btn.id = BUTTON_ID;
        btn.href = '/k/' + INQUIRY_APP_ID + '/';
        var labelSpan = document.createElement('span');
        labelSpan.textContent = '📩 お問い合わせ（デジタル委員会宛て）';
        btn.appendChild(labelSpan);

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

        // タップ演出（リップル＋遷移中の進捗バー）。ホバーはCSS側のメディアクエリで行う
        btn.className = 'iqb-tap';
        attachTapFeedback(btn, true);

        return btn;
    }

    // ============================================================
    // タップ演出: <style> 注入
    // ============================================================
    /**
     * タップ演出（リップル＋遷移中の進捗バー）用の <style> を一度だけ注入する。
     * 押下・遷移中の見た目はクラス（iqb-tap と状態クラス）で切り替えるため、
     * インラインstyleとぶつかるプロパティ（transition/transform 等）は付与側で外してある。
     */
    function injectTapStyle() {
        if (document.getElementById(TAP_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = TAP_STYLE_ID;
        style.textContent =
            '.iqb-tap{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;overflow:hidden;isolation:isolate;cursor:pointer;transition:filter 150ms ease, background-color 150ms ease;position:relative;}' +
            '.iqb-tap > span{position:relative;z-index:1;}' +
            '.iqb-tap:focus:not(:focus-visible){outline:none;}' +
            '.iqb-tap:focus-visible{outline:2px solid #a92d2a;outline-offset:2px;}' +
            '.iqb-tap::before{content:"";position:absolute;z-index:0;pointer-events:none;left:var(--iqb-rx,50%);top:var(--iqb-ry,50%);width:var(--iqb-rd,200px);height:var(--iqb-rd,200px);margin:calc(var(--iqb-rd,200px) / -2) 0 0 calc(var(--iqb-rd,200px) / -2);border-radius:50%;background:rgba(255,255,255,.32);transform:scale(0);opacity:0;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 350ms ease;}' +
            '.iqb-tap.is-pressed::before{transform:scale(1);opacity:1;transition:transform 450ms cubic-bezier(.2,.8,.3,1), opacity 60ms;}' +
            '.iqb-tap.is-navigating::before{transform:scale(1);opacity:.55;}' +
            '.iqb-tap.is-navigating::after{content:"";position:absolute;z-index:1;pointer-events:none;left:0;bottom:0;height:3px;width:40%;background:rgba(255,255,255,.9);border-radius:3px;animation:iqb-tap-bar 1s ease-in-out infinite;}' +
            '@keyframes iqb-tap-bar{from{transform:translateX(-100%)}to{transform:translateX(250%)}}' +
            '@media (hover:hover) and (pointer:fine){.iqb-tap:hover{filter:brightness(1.1);}}' +
            '@media (prefers-reduced-motion: reduce){.iqb-tap{transition:none;}.iqb-tap::before{display:none;}.iqb-tap.is-pressed{filter:brightness(.88);}.iqb-tap.is-navigating::after{animation:none;width:100%;opacity:.6;}}';
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
        var els = document.querySelectorAll('.iqb-tap.is-pressed, .iqb-tap.is-navigating');
        for (var i = 0; i < els.length; i++) {
            els[i].classList.remove('is-pressed');
            els[i].classList.remove('is-navigating');
        }
    }

    /**
     * 要素にタップ演出（リップル＋遷移中の進捗バー）を付ける。
     * @param {HTMLElement} el 対象要素（className に iqb-tap を含めること）
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
            el.style.setProperty('--iqb-rx', x + 'px');
            el.style.setProperty('--iqb-ry', y + 'px');
            el.style.setProperty('--iqb-rd', d + 'px');
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
