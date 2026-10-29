'use strict';
/**
 * portal-navigation.js（テンプレート版）の単体テスト。
 * Node 標準の node:test と node:vm だけを使う（依存の追加なし）。
 * 実行: node --test scripts/tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

const describe = test.describe;
const SRC_PATH = path.join(__dirname, '../../テンプレートフォルダ/ポータルナビ/portal-navigation.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/** vm の別レルムで作られたオブジェクトを、deepStrictEqual で比べられる素のオブジェクトにする。 */
function plain(x) {
    return JSON.parse(JSON.stringify(x));
}

function makeStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
        clear: () => { m.clear(); }
    };
}

function makeElement() {
    return {
        style: { setProperty() {} },
        setAttribute() {},
        getAttribute() { return null; },
        appendChild(c) { return c; },
        insertBefore(c) { return c; },
        addEventListener() {},
        removeEventListener() {},
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {}, contains() { return false; } },
        getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; }
    };
}

/**
 * テンプレート版を vm で実行し、スタブと呼び出し記録を返す。
 * opts.pathname でモバイル／PC の画面を切り替える。opts.context を渡すと同じコンテキストで再実行する。
 */
function loadModule(opts) {
    opts = opts || {};
    const rec = { eventsOn: [], apiCalls: [], bodyAppends: [], warns: [], created: [] };
    let ctx = opts.context;
    if (!ctx) {
        const body = makeElement();
        const origAppend = body.appendChild;
        body.appendChild = (c) => { rec.bodyAppends.push(c); return origAppend(c); };
        const head = makeElement();
        ctx = {
            localStorage: makeStorage(),
            sessionStorage: makeStorage(),
            document: {
                getElementById() { return null; },
                createElement() { const e = makeElement(); rec.created.push(e); return e; },
                head: head,
                body: body,
                querySelectorAll() { return []; },
                addEventListener() {},
                removeEventListener() {}
            },
            location: { pathname: opts.pathname || '/k/' },
            kintone: {
                events: { on: (ev, fn) => { rec.eventsOn.push({ events: ev, fn: fn }); } },
                api: Object.assign(
                    (...args) => { rec.apiCalls.push(args); },
                    { url: (p) => p }
                ),
                getLoginUser: () => ({ id: '1', code: 'tester', name: 'テスター' }),
                portal: { getContentSpaceElement: () => makeElement() },
                mobile: { portal: { getContentSpaceElement: () => makeElement() } }
            },
            crypto: globalThis.crypto,
            TextEncoder: globalThis.TextEncoder,
            btoa: globalThis.btoa,
            atob: globalThis.atob,
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout,
            addEventListener() {},
            isSecureContext: true,
            console: {
                log() {}, error() {},
                warn: (...args) => { rec.warns.push(args.join(' ')); }
            }
        };
        vm.createContext(ctx);
        ctx.window = ctx;
    }
    vm.runInContext(opts.src || SRC, ctx, { filename: 'portal-navigation.js' });
    return { ctx: ctx, rec: rec, api: ctx.PortalNavigation && ctx.PortalNavigation.__test__ };
}

// ---- テスト用データ ----
function sc(n) {
    return { type: 'app', targetId: 'demo-app-' + n, targetName: 'App' + n, label: 'App' + n, labelCustom: false };
}
const LIST4 = [1, 2, 3, 4].map(sc);

function globalRaw(overrides) {
    return JSON.stringify(Object.assign({
        schemaVersion: 1,
        settingsRev: 13,
        shortcuts: LIST4,
        design: { scTheme: 'green', scShape: 'rounded', homeTheme: 'purple', homeShape: 'rounded' },
        shortcutsForceRev: 0,
        designForceRev: 0,
        updatedBy: '管理者',
        updatedAt: '2026-10-28T00:00:00.000Z'
    }, overrides || {}));
}

describe('1. 読み込み', () => {
    test('例外なく読み込め、イベントが登録され、PC画面ではホームボタンを作らない', () => {
        const { ctx, rec } = loadModule({ pathname: '/k/' });
        assert.equal(ctx.PortalNavigation.loaded, true);
        const evs = rec.eventsOn.map((e) => JSON.stringify(e.events));
        assert.ok(evs.includes(JSON.stringify(['portal.show', 'mobile.portal.show'])), 'PORTAL_EVENTS');
        assert.ok(evs.includes(JSON.stringify([
            'mobile.app.record.index.show', 'mobile.app.record.detail.show', 'mobile.space.portal.show'
        ])), 'HOME_EVENTS');
        assert.equal(rec.bodyAppends.length, 0, 'PC画面では body に何も追加しない');
    });

    test('全体設定がプレースホルダーのままなら kintone.api を一度も呼ばない', () => {
        const { rec } = loadModule({ pathname: '/k/' });
        assert.equal(rec.apiCalls.length, 0);
    });

    test('モバイル画面ではホームボタンを無条件にマウントする', () => {
        const { rec } = loadModule({ pathname: '/k/m/' });
        assert.equal(rec.bodyAppends.length, 1);
        assert.equal(rec.apiCalls.length, 0);
    });
});

describe('2. 二重読み込み', () => {
    test('同じコンテキストで2回実行すると2回目は即 return する', () => {
        const first = loadModule({ pathname: '/k/' });
        const count = first.rec.eventsOn.length;
        assert.ok(count >= 2);
        loadModule({ context: first.ctx });
        assert.equal(first.rec.eventsOn.length, count);
        assert.ok(first.rec.warns.some((w) => w.includes('二重に読み込まれた')));
    });
});

describe('3. isGlobalAvailable / isSyncAvailable', () => {
    test('テンプレート版ではどちらも false', () => {
        const { api } = loadModule();
        assert.equal(api.isGlobalAvailable(), false);
        assert.equal(api.isSyncAvailable(), false);
    });
});

describe('4. isPersonalValid', () => {
    test('改訂番号の比較', () => {
        const { api } = loadModule();
        assert.equal(api.isPersonalValid(0, 0), true);
        assert.equal(api.isPersonalValid(5, 3), true);
        assert.equal(api.isPersonalValid(3, 3), true);
        assert.equal(api.isPersonalValid(2, 3), false);
        assert.equal(api.isPersonalValid(undefined, 0), true);
        assert.equal(api.isPersonalValid(undefined, 1), false);
    });
    test('キャッシュが古い端末（baseRev が手元の settingsRev より大きい）でも個人設定は有効', () => {
        const { api } = loadModule();
        // 手元の settingsRev=3・forceRev=3 のところへ baseRev=4 の個人設定が同期で届いた場合
        assert.equal(api.isPersonalValid(4, 3), true);
        assert.equal(api.isPersonalValid(9, 3), true);
    });
});

describe('5. resolveShortcutList', () => {
    const { api } = loadModule();
    const defaults = [1, 2, 3, 4].map((n) => sc(n + 10));
    const personalList = [1, 2, 3, 4, 5].map((n) => sc(n + 20));
    const globalList = [1, 2, 3, 4].map((n) => sc(n + 30));

    test('個人設定が有効なら個人設定', () => {
        const r = api.resolveShortcutList({ buttons: personalList, baseRev: 5 }, { shortcuts: globalList, shortcutsForceRev: 3 }, defaults);
        assert.equal(r.source, 'personal');
        assert.equal(r.forced, false);
        assert.deepEqual(plain(r.list), plain(personalList));
    });
    test('個人設定が古ければ全体設定で forced:true', () => {
        const r = api.resolveShortcutList({ buttons: personalList, baseRev: 2 }, { shortcuts: globalList, shortcutsForceRev: 3 }, defaults);
        assert.equal(r.source, 'global');
        assert.equal(r.forced, true);
        assert.deepEqual(plain(r.list), plain(globalList));
    });
    test('全体設定が null なら既定値（個人設定も無ければ）', () => {
        const r = api.resolveShortcutList(null, null, defaults);
        assert.equal(r.source, 'default');
        assert.equal(r.forced, false);
        assert.deepEqual(plain(r.list), plain(defaults));
    });
    test('gs.shortcuts が null なら既定値', () => {
        const r = api.resolveShortcutList(null, { shortcuts: null, shortcutsForceRev: 0 }, defaults);
        assert.equal(r.source, 'default');
        assert.deepEqual(plain(r.list), plain(defaults));
    });
    test('個人設定が無ければ全体設定で forced:false', () => {
        const r = api.resolveShortcutList(null, { shortcuts: globalList, shortcutsForceRev: 9 }, defaults);
        assert.equal(r.source, 'global');
        assert.equal(r.forced, false);
    });
});

describe('6. resolveDesign', () => {
    const { api } = loadModule();
    const gs = {
        design: { scTheme: 'purple', scShape: 'rounded', homeTheme: 'green', homeShape: 'rounded' },
        designForceRev: 0
    };

    test('個人設定が無ければ全体設定の値', () => {
        const r = api.resolveDesign(null, gs);
        assert.deepEqual(plain(r), { scTheme: 'purple', scShape: 'rounded', homeTheme: 'purple', homeShape: 'rounded', forced: false });
    });
    test('全体設定が無ければ DEFAULT_DESIGN', () => {
        const r = api.resolveDesign(null, null);
        const d = api.constants.DEFAULT_DESIGN;
        assert.equal(r.scTheme, d.scTheme);
        assert.equal(r.scShape, d.scShape);
        assert.equal(r.homeTheme, d.homeTheme);
        assert.equal(r.homeShape, d.homeShape);
        assert.equal(r.forced, false);
    });
    test('個人設定はキー単位で上書きされる', () => {
        const r = api.resolveDesign({ scThemeIdx: 1, scShapeIdx: null, rev: 0 }, gs);
        assert.equal(r.scTheme, 'green');
        assert.equal(r.scShape, 'rounded');
        assert.equal(r.homeTheme, 'green');
        assert.equal(r.homeShape, 'rounded');
        assert.equal(r.forced, false);
    });
    test('rev < designForceRev なら全体設定の値で forced:true', () => {
        const r = api.resolveDesign({ scThemeIdx: 0, scShapeIdx: 0, rev: 1 }, Object.assign({}, gs, { designForceRev: 2 }));
        assert.equal(r.forced, true);
        assert.equal(r.scTheme, 'purple');
        assert.equal(r.scShape, 'rounded');
        assert.equal(r.homeTheme, 'purple');
    });
    test('ホームの形はショートカットの形から決まる', () => {
        const r = api.resolveDesign({ scThemeIdx: null, scShapeIdx: 0, rev: 0 }, gs);
        assert.equal(r.homeShape, 'circle');
    });
    test('全体設定の homeTheme/homeShape が違っても揃う', () => {
        const g2 = { design: { scTheme: 'navy', scShape: 'capsule', homeTheme: 'standard', homeShape: 'rounded' }, designForceRev: 0 };
        const r = api.resolveDesign(null, g2);
        assert.equal(r.homeTheme, 'navy');
        assert.equal(r.homeShape, 'circle');
    });
    test('旧 homeThemeIdx だけでは個人設定ありとみなさない', () => {
        const r = api.resolveDesign({ scThemeIdx: null, scShapeIdx: null, homeThemeIdx: 3, rev: 0 }, Object.assign({}, gs, { designForceRev: 5 }));
        assert.equal(r.forced, false);
        assert.equal(r.homeTheme, 'purple');
    });
    test('範囲外の添字は無視される', () => {
        const r = api.resolveDesign({ scThemeIdx: 99, scShapeIdx: 99, rev: 0 }, gs);
        assert.equal(r.scTheme, 'purple');
        assert.equal(r.scShape, 'rounded');
        assert.equal(r.homeTheme, 'purple');
    });
});

describe('7. isCacheFresh', () => {
    const { api } = loadModule();
    const ttl = 600000;
    const now = 10000000;
    test('fresh', () => {
        assert.equal(api.isCacheFresh({ appId: '101', fetchedAt: now - 1000 }, now, ttl, '101'), true);
        assert.equal(api.isCacheFresh({ appId: '101', fetchedAt: now }, now, ttl, 101), true);
    });
    test('ちょうど TTL のときは stale', () => {
        assert.equal(api.isCacheFresh({ appId: '101', fetchedAt: now - ttl }, now, ttl, '101'), false);
    });
    test('appId 不一致', () => {
        assert.equal(api.isCacheFresh({ appId: '102', fetchedAt: now }, now, ttl, '101'), false);
    });
    test('未来の fetchedAt', () => {
        assert.equal(api.isCacheFresh({ appId: '101', fetchedAt: now + 1 }, now, ttl, '101'), false);
    });
    test('null や数値でない fetchedAt', () => {
        assert.equal(api.isCacheFresh(null, now, ttl, '101'), false);
        assert.equal(api.isCacheFresh({ appId: '101', fetchedAt: '123' }, now, ttl, '101'), false);
        assert.equal(api.isCacheFresh({ appId: '101' }, now, ttl, '101'), false);
    });
});

describe('8. parseGlobalSettingsJson', () => {
    const { api } = loadModule();

    test('空文字・壊れた JSON・schemaVersion 違いは null', () => {
        assert.equal(api.parseGlobalSettingsJson(''), null);
        assert.equal(api.parseGlobalSettingsJson(null), null);
        assert.equal(api.parseGlobalSettingsJson('{not json'), null);
        assert.equal(api.parseGlobalSettingsJson(globalRaw({ schemaVersion: 2 })), null);
        assert.equal(api.parseGlobalSettingsJson('[]'), null);
    });
    test('正常なものは正規化される', () => {
        const g = api.parseGlobalSettingsJson(globalRaw({ shortcutsForceRev: 5, designForceRev: 13 }));
        assert.equal(g.settingsRev, 13);
        assert.equal(g.shortcuts.length, 4);
        assert.equal(g.shortcuts[0].targetId, 'demo-app-1');
        assert.equal(g.design.scTheme, 'green');
        assert.equal(g.design.homeShape, 'rounded');
        assert.equal(g.shortcutsForceRev, 5);
        assert.equal(g.designForceRev, 13);
        assert.equal(g.updatedBy, '管理者');
    });
    test('forceRev が settingsRev を超えれば切り詰められる', () => {
        const g = api.parseGlobalSettingsJson(globalRaw({ settingsRev: 5, shortcutsForceRev: 9, designForceRev: 99 }));
        assert.equal(g.shortcutsForceRev, 5);
        assert.equal(g.designForceRev, 5);
    });
    test('不明な theme は既定値になる', () => {
        const g = api.parseGlobalSettingsJson(globalRaw({ design: { scTheme: 'rainbow', scShape: 'capsule', homeTheme: 'x', homeShape: 'circle' } }));
        assert.equal(g.design.scTheme, 'navy');
        assert.equal(g.design.homeTheme, 'navy');
        assert.equal(g.design.scShape, 'capsule');
    });
    test('shortcuts が3件または7件なら shortcuts:null', () => {
        const three = api.parseGlobalSettingsJson(globalRaw({ shortcuts: [1, 2, 3].map(sc) }));
        assert.equal(three.shortcuts, null);
        const seven = api.parseGlobalSettingsJson(globalRaw({ shortcuts: [1, 2, 3, 4, 5, 6, 7].map(sc) }));
        assert.equal(seven.shortcuts, null);
        assert.equal(seven.settingsRev, 13);
    });
    test('settingsRev:-1 は 0 になる', () => {
        const g = api.parseGlobalSettingsJson(globalRaw({ settingsRev: -1, shortcutsForceRev: 3 }));
        assert.equal(g.settingsRev, 0);
        assert.equal(g.shortcutsForceRev, 0);
    });
    test('中身の無いスペース要素なら shortcuts:null', () => {
        const bad = LIST4.slice(0, 3).concat([{ type: 'space', targetId: '', targetName: '', label: '', labelCustom: false }]);
        const g = api.parseGlobalSettingsJson(globalRaw({ shortcuts: bad }));
        assert.equal(g.shortcuts, null);
    });
});

describe('9. buildGlobalSettingsPayload', () => {
    const { api } = loadModule();
    const draft = {
        shortcuts: LIST4,
        design: { scTheme: 'green', scShape: 'rounded', homeTheme: 'standard', homeShape: 'circle' }
    };
    const prev = { shortcutsForceRev: 2, designForceRev: 1 };

    test('forceSc なら shortcutsForceRev が nextRev、そうでなければ prev を引き継ぐ', () => {
        const p1 = api.buildGlobalSettingsPayload(draft, 8, true, false, prev);
        assert.equal(p1.settingsRev, 8);
        assert.equal(p1.shortcutsForceRev, 8);
        assert.equal(p1.designForceRev, 1);
        const p2 = api.buildGlobalSettingsPayload(draft, 8, false, true, prev);
        assert.equal(p2.shortcutsForceRev, 2);
        assert.equal(p2.designForceRev, 8);
        const p3 = api.buildGlobalSettingsPayload(draft, 1, false, false, null);
        assert.equal(p3.shortcutsForceRev, 0);
        assert.equal(p3.designForceRev, 0);
    });
    test('出力をパースし直すと同じ内容になる', () => {
        const payload = api.buildGlobalSettingsPayload(draft, 8, true, true, prev);
        const back = api.parseGlobalSettingsJson(JSON.stringify(payload));
        assert.deepEqual(plain(back), plain(payload));
        assert.equal(payload.updatedBy, 'テスター');
    });
    test('home* は scTheme/scShape からの派生値で保存される', () => {
        const payload = api.buildGlobalSettingsPayload(draft, 8, false, false, prev);
        assert.equal(payload.design.homeTheme, 'green');
        assert.equal(payload.design.homeShape, 'rounded');
    });
});

describe('10. parsePersonalPayload / buildSettingsPayload', () => {
    const { api } = loadModule();

    test('v2 で baseRev が無ければ 0', () => {
        const p = api.parsePersonalPayload(JSON.stringify({ version: 2, buttons: LIST4 }));
        assert.equal(p.baseRev, 0);
        assert.equal(p.buttons.length, 4);
    });
    test('v1 は v2 に移行され baseRev は 0', () => {
        const v1 = {
            version: 1,
            buttons: [1, 2, 3, 4].map((n) => ({ appId: 'demo-app-' + n, appName: 'A' + n, label: 'A' + n, labelCustom: false }))
        };
        const p = api.parsePersonalPayload(JSON.stringify(v1));
        assert.equal(p.baseRev, 0);
        assert.equal(p.buttons[0].type, 'app');
        assert.equal(p.buttons[0].targetId, 'demo-app-1');
        assert.equal(p.buttons[0].targetName, 'A1');
    });
    test('buildSettingsPayload(list, 7) を往復させると baseRev === 7', () => {
        const payload = api.buildSettingsPayload(LIST4, 7);
        assert.equal(payload.version, 2);
        const back = api.parsePersonalPayload(JSON.stringify(payload));
        assert.equal(back.baseRev, 7);
        assert.deepEqual(plain(back.buttons), plain(LIST4));
    });
    test('baseRev を渡さなければ 0', () => {
        assert.equal(api.buildSettingsPayload(LIST4).baseRev, 0);
    });
    test('parseSettingsJson は配列を返す（互換）、無効なら null', () => {
        const arr = api.parseSettingsJson(JSON.stringify({ version: 2, buttons: LIST4, baseRev: 3 }));
        assert.ok(Array.isArray(arr));
        assert.equal(arr.length, 4);
        assert.equal(api.parseSettingsJson('{}'), null);
        assert.equal(api.parseSettingsJson(''), null);
        assert.equal(api.parsePersonalPayload(JSON.stringify({ version: 2, buttons: LIST4.slice(0, 3) })), null);
    });
});

describe('11. 認証', () => {
    const { api } = loadModule();

    test('createAuthRecord は parseAuthJson を通り、iter と salt 長が仕様どおり', async () => {
        const rec = await api.createAuthRecord('password123', 'tester');
        const parsed = api.parseAuthJson(JSON.stringify(rec));
        assert.ok(parsed);
        assert.equal(parsed.iter, 100000);
        assert.equal(parsed.alg, 'PBKDF2-SHA256');
        assert.equal(api.base64ToBytes(parsed.salt).length, 16);
        assert.equal(api.base64ToBytes(parsed.hash).length, 32);
        assert.equal(rec.updatedBy, 'tester');
    });

    test('verifyPassword は正しいパスワードで true、間違いで false', async () => {
        const rec = await api.createAuthRecord('password123', 'tester');
        assert.equal(await api.verifyPassword('password123', rec), true);
        assert.equal(await api.verifyPassword('password124', rec), false);
    });

    test('hashPassword は node:crypto の pbkdf2Sync と一致する', async () => {
        const salt = new Uint8Array(16).fill(7);
        const got = await api.hashPassword('pw', salt, 1000);
        const expected = nodeCrypto.pbkdf2Sync('pw', Buffer.from(salt), 1000, 32, 'sha256');
        assert.equal(Buffer.from(got).toString('hex'), expected.toString('hex'));
    });

    test('parseAuthJson は不正な形式で null', async () => {
        const good = plain(await api.createAuthRecord('password123', 'tester'));
        assert.ok(api.parseAuthJson(JSON.stringify(good)));
        assert.equal(api.parseAuthJson(JSON.stringify(Object.assign({}, good, { alg: 'PBKDF2-SHA1' }))), null);
        assert.equal(api.parseAuthJson(JSON.stringify(Object.assign({}, good, { iter: 9999 }))), null);
        assert.equal(api.parseAuthJson(JSON.stringify(Object.assign({}, good, { salt: '***' }))), null);
        assert.equal(api.parseAuthJson(JSON.stringify(Object.assign({}, good, { hash: 'AAAA' }))), null);
        assert.equal(api.parseAuthJson(JSON.stringify(Object.assign({}, good, { v: 2 }))), null);
        assert.equal(api.parseAuthJson(''), null);
        assert.equal(api.parseAuthJson('{oops'), null);
    });

    test('timingSafeEqual は長さが違えば false', () => {
        assert.equal(api.timingSafeEqual([1, 2, 3], [1, 2]), false);
        assert.equal(api.timingSafeEqual([1, 2, 3], [1, 2, 3]), true);
        assert.equal(api.timingSafeEqual([1, 2, 3], [1, 2, 4]), false);
    });
});

describe('12. ロック', () => {
    const { api } = loadModule();
    test('4回失敗してもロックされず、5回目でロックされ、期限後に解除される', () => {
        const now = 1000000;
        let lock = null;
        for (let i = 1; i <= 4; i++) {
            lock = api.registerFailure(lock, now);
            const st = api.computeLockState(lock, now);
            assert.equal(st.locked, false);
            assert.equal(st.fails, i);
        }
        lock = api.registerFailure(lock, now);
        const locked = api.computeLockState(lock, now);
        assert.equal(locked.locked, true);
        assert.equal(locked.remainingMs, 5 * 60 * 1000);
        assert.equal(api.computeLockState(lock, now + 5 * 60 * 1000 - 1).locked, true);
        assert.equal(api.computeLockState(lock, now + 5 * 60 * 1000 + 1).locked, false);
        assert.equal(api.computeLockState(null, now).locked, false);
    });
});

describe('13. isAuthSessionValid', () => {
    const { api } = loadModule();
    const now = 5000000;
    test('期限内は true、期限切れと appId 不一致は false', () => {
        assert.equal(api.isAuthSessionValid({ appId: '101', until: now + 1000 }, now, '101'), true);
        assert.equal(api.isAuthSessionValid({ appId: '101', until: now - 1 }, now, '101'), false);
        assert.equal(api.isAuthSessionValid({ appId: '101', until: now }, now, '101'), false);
        assert.equal(api.isAuthSessionValid({ appId: '102', until: now + 1000 }, now, '101'), false);
        assert.equal(api.isAuthSessionValid(null, now, '101'), false);
    });
});

describe('14. isConflictError', () => {
    const { api } = loadModule();
    test('GAIA_CO02 は true、それ以外は false', () => {
        assert.equal(api.isConflictError({ code: 'GAIA_CO02' }), true);
        assert.equal(api.isConflictError({ code: 'CB_VA01', message: 'invalid' }), false);
        assert.equal(api.isConflictError(null), false);
    });
    test('message に revision を含む場合も true', () => {
        assert.equal(api.isConflictError({ code: 'X', message: 'specified revision is not latest' }), true);
    });
});

describe('15. isMobilePath', () => {
    const { api } = loadModule();
    test('モバイルのパスだけ true', () => {
        assert.equal(api.isMobilePath('/k/m/'), true);
        assert.equal(api.isMobilePath('/k/m'), true);
        assert.equal(api.isMobilePath('/k/guest/3/m/'), true);
        assert.equal(api.isMobilePath('/k/'), false);
        assert.equal(api.isMobilePath('/k/#/space/1'), false);
    });
});

describe('定数', () => {
    const { api } = loadModule();
    test('色4種・形2種・ホーム形2種がモックアップの仕様どおり', () => {
        const c = api.constants;
        assert.deepEqual(plain(c.THEMES.map((t) => t.label)), ['ネイビー', 'グリーン', 'パープル', 'スタンダード']);
        assert.deepEqual(plain(c.SHAPES.map((s) => s.label)), ['カプセル', '角丸']);
        assert.deepEqual(plain(c.HOME_SHAPES.map((s) => s.name)), ['circle', 'rounded']);
        assert.equal(c.THEMES[0].homeGrad, 'linear-gradient(135deg, #2b7bc0 0%, #154260 100%)');
        assert.equal(c.THEMES[0].homeShadow, '0 4px 12px rgba(21, 66, 96, 0.4)');
        assert.equal(c.GLOBAL_CACHE_TTL_MS, 600000);
        assert.equal(c.PBKDF2_ITERATIONS, 100000);
        assert.equal(c.AUTH_MAX_FAILS, 5);
        assert.equal(c.AUTH_LOCK_MS, 300000);
    });
});

// ---- 結合テスト（全体設定アプリの ID を数字にしたソースで実行する） ----
const GS_ID = '1234'; // テスト用のダミーID（実際のアプリIDではない）
const SRC_GLOBAL = SRC.replace("var GLOBAL_SETTINGS_APP_ID = 'your-global-settings-app-id';", "var GLOBAL_SETTINGS_APP_ID = '" + GS_ID + "';");

/** kintone.api を差し替え、呼び出しを記録する。各呼び出しの応答は pending から手で返す。 */
function installApi(ctx) {
    const calls = [];
    ctx.kintone.api = Object.assign((...args) => { calls.push({ path: args[0], method: args[1], params: args[2], ok: args[3], ng: args[4] }); },
        { url: (p) => p });
    return calls;
}

function globalRecordResp(raw, id, rev) {
    const rec = { $id: { value: String(id || 1) }, $revision: { value: String(rev || 1) } };
    rec.settings_json = { value: raw };
    return { records: [rec] };
}

describe('16. 全体設定が使えるとき: refreshGlobalSettings', () => {
    test('ソース置換が効いていて isGlobalAvailable が true になる', () => {
        assert.notEqual(SRC_GLOBAL, SRC);
        assert.equal(loadModule({ src: SRC_GLOBAL }).api.isGlobalAvailable(), true);
    });

    test('取得は fields 指定付きで1回呼ばれ、キャッシュに書かれる', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        const calls = installApi(ctx);
        api.refreshGlobalSettings(false);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].path, '/k/v1/records.json');
        assert.equal(calls[0].params.app, GS_ID);
        assert.deepEqual(plain(calls[0].params.fields), ['$id', '$revision', 'settings_json']);
        calls[0].ok(globalRecordResp(globalRaw(), 3, 7));
        const cache = JSON.parse(ctx.localStorage.getItem('kintone_portal_global_settings_v1'));
        assert.equal(cache.appId, GS_ID);
        assert.equal(cache.recordId, '3');
        assert.equal(cache.recordRevision, '7');
        assert.equal(cache.settingsRaw, globalRaw());
    });

    test('キャッシュが新しい間は再取得しない（force なら取る）', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        const calls = installApi(ctx);
        api.refreshGlobalSettings(false);
        calls[0].ok(globalRecordResp(globalRaw()));
        api.refreshGlobalSettings(false);
        assert.equal(calls.length, 1, 'TTL 内は抑止');
        api.refreshGlobalSettings(true);
        assert.equal(calls.length, 2, 'force は取り直す');
    });

    test('取得中の同時呼び出しは1回にまとめ、コールバックは全員に届く', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        const calls = installApi(ctx);
        let changed = 0;
        let settled = 0;
        api.refreshGlobalSettings(false, () => { changed++; });
        api.refreshGlobalSettings(false, () => { changed++; }, () => { settled++; });
        api.refreshGlobalSettings(true, null, () => { settled++; });
        assert.equal(calls.length, 1);
        calls[0].ok(globalRecordResp(globalRaw()));
        assert.equal(changed, 2);
        assert.equal(settled, 2);
    });

    test('onChanged は内容が変わったときだけ呼ばれ、onSettled は常に呼ばれる', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        const calls = installApi(ctx);
        let changed = 0;
        let settled = 0;
        const onChanged = () => { changed++; };
        const onSettled = () => { settled++; };
        api.refreshGlobalSettings(true, onChanged, onSettled);
        calls[0].ok(globalRecordResp(globalRaw()));
        assert.equal(changed, 1, '初回は変化あり');
        api.refreshGlobalSettings(true, onChanged, onSettled);
        calls[1].ok(globalRecordResp(globalRaw()));
        assert.equal(changed, 1, '同じ内容なら呼ばれない');
        assert.equal(settled, 2);
        api.refreshGlobalSettings(true, onChanged, onSettled);
        calls[2].ok(globalRecordResp(globalRaw({ settingsRev: 14 })));
        assert.equal(changed, 2, '内容が変われば呼ばれる');
    });

    test('取得に失敗してもキャッシュは変えず、次の呼び出しで取り直せる', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        const calls = installApi(ctx);
        api.refreshGlobalSettings(false);
        calls[0].ng(new Error('x'));
        assert.equal(ctx.localStorage.getItem('kintone_portal_global_settings_v1'), null);
        api.refreshGlobalSettings(false);
        assert.equal(calls.length, 2);
    });
});

describe('17. savePersonalDesign / clearPersonalDesign', () => {
    function setup(gsRaw) {
        const m = loadModule({ src: SRC_GLOBAL });
        m.ctx.localStorage.setItem('kintone_portal_global_settings_v1', JSON.stringify({
            appId: GS_ID, recordId: '1', recordRevision: '1', fetchedAt: Date.now(), settingsRaw: gsRaw
        }));
        return m;
    }

    test('色と形を一括で書き、design_rev は1回だけ、旧キーは消す', () => {
        const { ctx, api } = setup(globalRaw({ settingsRev: 13, designForceRev: 5 }));
        ctx.localStorage.setItem('kintone_portal_home_theme_idx', '3');
        ctx.localStorage.setItem('kintone_portal_design_rev', '9');
        const writes = [];
        const orig = ctx.localStorage.setItem;
        ctx.localStorage.setItem = (k, v) => { writes.push(k); return orig(k, v); };
        const ok = api.savePersonalDesign('purple', 'rounded');
        ctx.localStorage.setItem = orig;
        assert.equal(ok, true);
        assert.equal(ctx.localStorage.getItem('kintone_portal_theme_idx'), '2');
        assert.equal(ctx.localStorage.getItem('kintone_portal_shape_idx'), '1');
        assert.equal(ctx.localStorage.getItem('kintone_portal_home_theme_idx'), null);
        assert.equal(ctx.localStorage.getItem('kintone_portal_design_rev'), '13');
        assert.equal(writes.filter((k) => k === 'kintone_portal_design_rev').length, 1);
    });

    test('強制反映中でも保存でき、保存後は forced:false で保存値が効く', () => {
        const { ctx, api } = setup(globalRaw({ settingsRev: 13, designForceRev: 13 }));
        ctx.localStorage.setItem('kintone_portal_theme_idx', '1');
        ctx.localStorage.setItem('kintone_portal_shape_idx', '1');
        ctx.localStorage.setItem('kintone_portal_design_rev', '4');
        assert.equal(api.savePersonalDesign('navy', 'capsule'), true);
        const gs = api.parseGlobalSettingsJson(globalRaw({ settingsRev: 13, designForceRev: 13 }));
        const r = api.resolveDesign(api.readPersonalDesign(), gs);
        assert.equal(r.forced, false);
        assert.equal(r.scTheme, 'navy');
        assert.equal(r.scShape, 'capsule');
        assert.equal(r.homeTheme, 'navy');
        assert.equal(r.homeShape, 'circle');
    });

    test('不正な名前なら false を返し、何も書かない', () => {
        const { ctx, api } = setup(globalRaw());
        assert.equal(api.savePersonalDesign('rainbow', 'rounded'), false);
        assert.equal(api.savePersonalDesign('navy', 'hexagon'), false);
        assert.equal(ctx.localStorage.getItem('kintone_portal_theme_idx'), null);
        assert.equal(ctx.localStorage.getItem('kintone_portal_shape_idx'), null);
        assert.equal(ctx.localStorage.getItem('kintone_portal_design_rev'), null);
    });

    test('全体設定が無ければ design_rev は 0 を記録する', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        api.savePersonalDesign('green', 'rounded');
        assert.equal(ctx.localStorage.getItem('kintone_portal_shape_idx'), '1');
        assert.equal(ctx.localStorage.getItem('kintone_portal_design_rev'), '0');
    });

    test('clearPersonalDesign で4キーがすべて消える', () => {
        const { ctx, api } = loadModule({ src: SRC_GLOBAL });
        ['theme_idx', 'shape_idx', 'home_theme_idx', 'design_rev'].forEach((k) => ctx.localStorage.setItem('kintone_portal_' + k, '1'));
        api.clearPersonalDesign();
        ['theme_idx', 'shape_idx', 'home_theme_idx', 'design_rev'].forEach((k) => {
            assert.equal(ctx.localStorage.getItem('kintone_portal_' + k), null, k);
        });
    });
});

describe('17b. 派生ヘルパー', () => {
    const { api } = loadModule();
    test('homeShapeNameForScShape', () => {
        assert.equal(api.homeShapeNameForScShape('capsule'), 'circle');
        assert.equal(api.homeShapeNameForScShape('rounded'), 'rounded');
        assert.equal(api.homeShapeNameForScShape('x'), 'circle');
    });
    test('withDerivedHome', () => {
        assert.deepEqual(plain(api.withDerivedHome({ scTheme: 'green', scShape: 'rounded', homeTheme: 'navy', homeShape: 'circle' })),
            { scTheme: 'green', scShape: 'rounded', homeTheme: 'green', homeShape: 'rounded' });
    });
});

describe('17c. デザイン設定モーダル（スモーク）', () => {
    test('例外なく開き、2回呼んでも枠は1つだけ追加される（多重オープン防止）', () => {
        const { api, rec } = loadModule({ pathname: '/k/' });
        const before = rec.bodyAppends.length;
        api.openDesignSettingsModal(() => {});
        const after1 = rec.bodyAppends.length;
        api.openDesignSettingsModal(() => {});
        assert.equal(after1 - before, 1);
        assert.equal(rec.bodyAppends.length, after1);
    });

    // 作成済みの要素から className / textContent で最新の1つを探す
    function lastEl(rec, pred) {
        return rec.created.slice().reverse().find(pred);
    }

    test('閉じた後にもう一度開ける（afterClose でフラグが戻る）', () => {
        const { api, rec } = loadModule({ pathname: '/k/' });
        const before = rec.bodyAppends.length;
        api.openDesignSettingsModal(() => {});
        lastEl(rec, (e) => e.className === 'psm-close').onclick();
        api.openDesignSettingsModal(() => {});
        assert.equal(rec.bodyAppends.length - before, 2);
    });

    test('未変更のとき保存は disabled、色を選ぶと有効になる。個人設定が無ければ「既定に戻す」も disabled', () => {
        const { api, rec } = loadModule({ pathname: '/k/' });
        api.openDesignSettingsModal(() => {});
        const saveBtn = lastEl(rec, (e) => e.className === 'psm-btn psm-btn-primary');
        const resetBtn = lastEl(rec, (e) => e.textContent === '管理者の既定に戻す');
        assert.equal(saveBtn.disabled, true);
        assert.equal(resetBtn.disabled, true);
        lastEl(rec, (e) => e.className === 'pna-swatch').onclick();
        assert.equal(saveBtn.disabled, false);
    });

    test('変更があるとき × は破棄確認を出し、拒否すると閉じない', () => {
        const { ctx, api, rec } = loadModule({ pathname: '/k/' });
        let asked = 0;
        ctx.confirm = () => { asked++; return false; };
        api.openDesignSettingsModal(() => {});
        lastEl(rec, (e) => e.className === 'pna-swatch').onclick();
        lastEl(rec, (e) => e.className === 'psm-close').onclick();
        assert.equal(asked, 1);
        const before = rec.bodyAppends.length;
        api.openDesignSettingsModal(() => {}); // まだ開いたままなので増えない
        assert.equal(rec.bodyAppends.length, before);
    });
});

describe('17d. buildShortcutPreview', () => {
    function stubDoc(ctx) {
        ctx.document.createElement = () => ({
            className: '', textContent: '', style: {}, children: [],
            appendChild(c) { this.children.push(c); return c; }
        });
    }
    test('先頭1件のラベルだけを1ボタンで表示する', () => {
        const { ctx, api } = loadModule({ pathname: '/k/' });
        stubDoc(ctx);
        const box = api.buildShortcutPreview(['A', 'B', 'C'], api.constants.THEMES[0], api.constants.SHAPES[0]);
        assert.equal(box.children.length, 1);
        assert.equal(box.children[0].textContent, 'A');
        assert.ok(box.children[0].className.indexOf('pna-preview-one') >= 0);
    });
    test('ラベルが空なら「ショートカット」を1ボタンで表示する', () => {
        const { ctx, api } = loadModule({ pathname: '/k/' });
        stubDoc(ctx);
        const box = api.buildShortcutPreview([], api.constants.THEMES[0], api.constants.SHAPES[0]);
        assert.equal(box.children.length, 1);
        assert.equal(box.children[0].textContent, 'ショートカット');
    });
    test('labels が undefined でも「ショートカット」を1ボタンで表示する', () => {
        const { ctx, api } = loadModule({ pathname: '/k/' });
        stubDoc(ctx);
        const box = api.buildShortcutPreview(undefined, api.constants.THEMES[0], api.constants.SHAPES[0]);
        assert.equal(box.children.length, 1);
        assert.equal(box.children[0].textContent, 'ショートカット');
    });
});

describe('18. checkAdminRights', () => {
    function setup(cacheOverrides) {
        const m = loadModule({ src: SRC_GLOBAL });
        m.ctx.localStorage.setItem('kintone_portal_global_settings_v1', JSON.stringify(Object.assign({
            appId: GS_ID, recordId: '5', recordRevision: '1', fetchedAt: Date.now(), settingsRaw: null
        }, cacheOverrides || {})));
        m.calls = installApi(m.ctx);
        return m;
    }

    test('プレースホルダーのままなら API を呼ばず null', () => {
        const m = loadModule();
        const calls = installApi(m.ctx);
        let got;
        m.api.checkAdminRights((r) => { got = r; });
        assert.equal(got, null);
        assert.equal(calls.length, 0);
    });

    test('キャッシュが無い、recordId が無い、appId が違うときは API を呼ばず null', () => {
        [null, { recordId: null }, { appId: '9999' }].forEach((o, i) => {
            const m = (i === 0) ? loadModule({ src: SRC_GLOBAL }) : setup(o);
            const calls = installApi(m.ctx);
            let got = 'unset';
            m.api.checkAdminRights((r) => { got = r; });
            assert.equal(got, null, 'case ' + i);
            assert.equal(calls.length, 0, 'case ' + i);
        });
    });

    test('配列形の fields を解析し、結果を sessionStorage にキャッシュする', () => {
        const m = setup();
        let got;
        m.api.checkAdminRights((r) => { got = r; });
        assert.equal(m.calls.length, 1);
        assert.equal(m.calls[0].path, '/k/v1/records/acl/evaluate.json');
        assert.equal(m.calls[0].params.app, GS_ID);
        assert.deepEqual(plain(m.calls[0].params.ids), ['5']);
        m.calls[0].ok({ rights: [{ record: { editable: true }, fields: [
            { code: 'auth_json', viewable: true, editable: false }, { code: 'settings_json', viewable: true, editable: true }
        ] }] });
        assert.deepEqual(plain(got), { editable: true, authViewable: true, authEditable: false });
        let again;
        m.api.checkAdminRights((r) => { again = r; });
        assert.equal(m.calls.length, 1, '10分以内はキャッシュを使う');
        assert.deepEqual(plain(again), plain(got));
    });

    test('オブジェクト形の fields も解析できる', () => {
        const m = setup();
        let got;
        m.api.checkAdminRights((r) => { got = r; });
        m.calls[0].ok({ rights: [{ record: { editable: true }, fields: { auth_json: { viewable: true, editable: true } } }] });
        assert.deepEqual(plain(got), { editable: true, authViewable: true, authEditable: true });
    });

    test('レコードを編集できない、フィールド権限が無い、応答が空、API 失敗のときの結果', () => {
        let m = setup();
        let got;
        m.api.checkAdminRights((r) => { got = r; });
        m.calls[0].ok({ rights: [{ record: { editable: false }, fields: [] }] });
        assert.deepEqual(plain(got), { editable: false, authViewable: false, authEditable: false });

        m = setup();
        got = 'unset';
        m.api.checkAdminRights((r) => { got = r; });
        m.calls[0].ok({ rights: [] });
        assert.equal(got, null);

        m = setup();
        got = 'unset';
        m.api.checkAdminRights((r) => { got = r; });
        m.calls[0].ng(new Error('x'));
        assert.equal(got, null);
    });
});

describe('19. setupHomeButton の重複ガード', () => {
    test('印の無い既存ボタン（旧ファイル製）には触れず、新しく作らない', () => {
        const m = loadModule({ pathname: '/k/' });
        let created = 0;
        const existing = Object.assign(makeElement(), { getAttribute: () => null });
        let touched = 0;
        existing.style = new Proxy({}, { set() { touched++; return true; } });
        m.ctx.document.getElementById = (id) => (id === 'mobile-home-shortcut' ? existing : null);
        const origCreate = m.ctx.document.createElement;
        m.ctx.document.createElement = (...a) => { if (a[0] === 'a') created++; return origCreate(...a); };
        const before = m.rec.bodyAppends.length;
        m.api.setupHomeButton();
        assert.equal(touched, 0, '見た目に触れない');
        assert.equal(m.rec.bodyAppends.length, before, 'body に追加しない');
        assert.equal(created, 0, 'ボタン（a 要素）を作らない');
    });

    test('印の付いた既存ボタン（本ファイル製）には見た目を当て直すだけで、新しく作らない', () => {
        const m = loadModule({ pathname: '/k/' });
        const existing = Object.assign(makeElement(), { getAttribute: (n) => (n === 'data-portal-nav' ? 'true' : null) });
        let touched = 0;
        existing.style = new Proxy({}, { set() { touched++; return true; } });
        m.ctx.document.getElementById = (id) => (id === 'mobile-home-shortcut' ? existing : null);
        const before = m.rec.bodyAppends.length;
        m.api.setupHomeButton();
        assert.ok(touched > 0, '色・形を当て直す');
        assert.equal(m.rec.bodyAppends.length, before);
    });
});

describe('20. イベントハンドラ経由の結合テスト', () => {
    test('プレースホルダーのとき portal.show / ホームのハンドラは全体設定・acl の API を呼ばない', () => {
        const m = loadModule({ pathname: '/k/' });
        const portal = m.rec.eventsOn.find((e) => e.events.includes('portal.show'));
        const home = m.rec.eventsOn.find((e) => e.events.includes('mobile.space.portal.show'));
        const ev = { type: 'portal.show' };
        assert.doesNotThrow(() => portal.fn(ev));
        assert.doesNotThrow(() => home.fn({ type: 'mobile.space.portal.show' }));
        const paths = m.rec.apiCalls.map((a) => String(a[0]));
        assert.ok(!paths.some((p) => p.includes('acl/evaluate') || (p.includes('records.json') && m.rec.apiCalls.some((a) => a[2] && a[2].app === GS_ID))));
        assert.equal(m.rec.apiCalls.filter((a) => a[2] && a[2].app === GS_ID).length, 0);
    });

    test('全体設定が使えるとき portal.show は全体設定を取得し、変化があれば再描画に進む', () => {
        const m = loadModule({ pathname: '/k/', src: SRC_GLOBAL });
        const calls = installApi(m.ctx);
        const portal = m.rec.eventsOn.find((e) => e.events.includes('portal.show'));
        assert.doesNotThrow(() => portal.fn({ type: 'portal.show' }));
        const gsCalls = calls.filter((c) => c.params && c.params.app === GS_ID);
        assert.equal(gsCalls.length, 1);
        assert.doesNotThrow(() => gsCalls[0].ok(globalRecordResp(globalRaw())));
        assert.equal(JSON.parse(m.ctx.localStorage.getItem('kintone_portal_global_settings_v1')).recordId, '1');
    });
});

describe('21. スペース候補の追加（管理者画面）', () => {
    const { api } = loadModule();
    test('extractSpaceIdFromInput: 数字・URL・空白付き', () => {
        assert.equal(api.extractSpaceIdFromInput('16'), '16');
        assert.equal(api.extractSpaceIdFromInput('https://example.cybozu.com/k/#/space/16'), '16');
        assert.equal(api.extractSpaceIdFromInput('  16  '), '16');
    });
    test('extractSpaceIdFromInput: 不正な入力は null', () => {
        assert.equal(api.extractSpaceIdFromInput(''), null);
        assert.equal(api.extractSpaceIdFromInput('abc'), null);
        assert.equal(api.extractSpaceIdFromInput(null), null);
        assert.equal(api.extractSpaceIdFromInput(16), null);
    });
    test('addSpaceCandidate: 追加すると true で日本語順に並ぶ', () => {
        const spaces = [{ id: '2', name: 'い' }];
        assert.equal(api.addSpaceCandidate(spaces, { id: '1', name: 'あ' }), true);
        assert.deepEqual(plain(spaces.map((s) => s.name)), ['あ', 'い']);
    });
    test('addSpaceCandidate: 同じ id は false で配列を変えない', () => {
        const spaces = [{ id: '1', name: 'あ' }, { id: '2', name: 'い' }];
        assert.equal(api.addSpaceCandidate(spaces, { id: '2', name: 'う' }), false);
        assert.deepEqual(plain(spaces.map((s) => s.id)), ['1', '2']);
        assert.equal(spaces.length, 2);
    });
});
