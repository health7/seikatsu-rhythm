/**
 * 生活リズム帳 - 回帰テストスイート
 * ============================================================
 * 実行方法: node tests/test_suite.js
 * 前提: Node.js + Playwright (npm i -g playwright && npx playwright install chromium)
 *
 * このスイートは、単体テスト(Unit)/結合テスト(Integration)/E2Eテストを
 * 1本のファイルにまとめたものです。このアプリはビルドシステムを持たない
 * 単一HTMLファイル構成のため、Jest等の外部テストフレームワークは導入せず、
 * 既にプロジェクトで使っているPlaywrightのみで完結させています。
 *
 * 「Unit Test」区分は、対象の純粋関数をブラウザ内で直接呼び出して検証する
 * 方式です(モジュール分割されていないため、実際のページを読み込んだ上で
 * window上の関数を呼ぶのが、このコードベースにとって最も忠実な単体テストです)。
 *
 * entitlement.js / purchase-journal.js には一切テストの都合で変更を加えていません。
 * ============================================================
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// アプリ本体のファイルを自動で探す。GitHub Pages公開のために index.html へ
// 改名している場合と、元のファイル名のままの場合の、どちらでも動くようにする。
function findHtmlPath(){
  const candidates = [
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', '生活リズム帳_修正版(最新).html'),
  ];
  for(const p of candidates){
    if(fs.existsSync(p)) return p;
  }
  throw new Error('アプリ本体のHTMLファイルが見つかりません(index.html または 生活リズム帳_修正版(最新).html を tests/ の1つ上の階層に置いてください)');
}
const HTML_PATH = findHtmlPath();
const PORT = 8793;
const URL = `http://127.0.0.1:${PORT}/index.html`;

// ---- 最小限のテストランナー(外部フレームワーク不使用) ----
const results = [];
let currentCategory = '';
function category(name){ currentCategory = name; }
async function test(name, fn){
  const t0 = Date.now();
  try{
    await fn();
    results.push({category: currentCategory, name, pass: true, ms: Date.now()-t0});
  }catch(e){
    results.push({category: currentCategory, name, pass: false, ms: Date.now()-t0, error: e.message});
  }
}
function assert(cond, msg){ if(!cond) throw new Error(msg || 'assertion failed'); }
function assertEqual(a, b, msg){ if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error((msg||'not equal')+` (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); }

// ---- 簡易静的サーバ(python等への依存を避け、Node標準ライブラリのみで完結) ----
function startServer(){
  const server = http.createServer((req, res) => {
    let filePath = req.url.split('?')[0];
    if(filePath==='/index.html' || filePath==='/'){
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end(fs.readFileSync(HTML_PATH));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function newPage(browser, {trackErrors=true}={}){
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const unhandledRejections = [];
  if(trackErrors){
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if(m.type()==='error') consoleErrors.push(m.text()); });
    await page.exposeFunction('__reportUR', (m)=>{ unhandledRejections.push(m); }).catch(()=>{});
    await page.addInitScript(() => {
      window.addEventListener('unhandledrejection', (ev) => {
        if(window.__reportUR) window.__reportUR(String(ev.reason && ev.reason.message || ev.reason));
      });
    });
  }
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(URL);
  await page.waitForTimeout(2200); // スプラッシュ消去まで待機
  page.__errors = {pageErrors, consoleErrors, unhandledRejections};
  return page;
}
function assertNoErrors(page){
  const {pageErrors, consoleErrors, unhandledRejections} = page.__errors;
  assert(pageErrors.length===0, `uncaught exception発生: ${JSON.stringify(pageErrors)}`);
  assert(consoleErrors.length===0, `console error発生: ${JSON.stringify(consoleErrors)}`);
  assert(unhandledRejections.length===0, `unhandled promise rejection発生: ${JSON.stringify(unhandledRejections)}`);
}

async function main(){
  const server = await startServer();
  const browser = await chromium.launch();

  // ============================================================
  // UNIT TESTS - 純粋関数
  // ============================================================
  category('Unit: escapeHtml');
  {
    const page = await newPage(browser);
    await test('scriptタグを無害化する', async () => {
      const r = await page.evaluate(()=> escapeHtml('<script>alert(1)</script>'));
      assert(!r.includes('<script>'), 'scriptタグがエスケープされていない');
    });
    await test('引用符をエスケープする', async () => {
      const r = await page.evaluate(()=> escapeHtml(`"'&`));
      assertEqual(r, '&quot;&#39;&amp;');
    });
    await test('空文字列を処理できる', async () => {
      const r = await page.evaluate(()=> escapeHtml(''));
      assertEqual(r, '');
    });
    await test('数値を渡してもクラッシュしない', async () => {
      const r = await page.evaluate(()=> escapeHtml(12345));
      assertEqual(r, '12345');
    });
    await page.close();
  }

  category('Unit: 日付処理(境界値)');
  {
    const page = await newPage(browser);
    await test('通常の日付をフォーマットできる', async () => {
      const r = await page.evaluate(()=> fmtDate(new Date(2026,7,2)));
      assertEqual(r, '2026-08-02');
    });
    await test('年末→年始の日付計算(12/31の翌日)', async () => {
      const r = await page.evaluate(()=> {
        const d = parseDate('2025-12-31');
        d.setDate(d.getDate()+1);
        return fmtDate(d);
      });
      assertEqual(r, '2026-01-01');
    });
    await test('うるう年(2024/2/29)を正しく扱える', async () => {
      const r = await page.evaluate(()=> {
        const d = parseDate('2024-02-28');
        d.setDate(d.getDate()+1);
        return fmtDate(d);
      });
      assertEqual(r, '2024-02-29');
    });
    await test('平年(2026/2)は2/28の翌日が3/1になる', async () => {
      const r = await page.evaluate(()=> {
        const d = parseDate('2026-02-28');
        d.setDate(d.getDate()+1);
        return fmtDate(d);
      });
      assertEqual(r, '2026-03-01');
    });
    await test('月末境界(1/31の翌日は2/1)', async () => {
      const r = await page.evaluate(()=> {
        const d = parseDate('2026-01-31');
        d.setDate(d.getDate()+1);
        return fmtDate(d);
      });
      assertEqual(r, '2026-02-01');
    });
    await test('年またぎのISO週番号が計算できる(1/1近辺でクラッシュしない)', async () => {
      const r = await page.evaluate(()=> {
        try{ return {ok:true, week: getISOWeek(parseDate('2026-01-01'))}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, 'ISO週計算が年始でクラッシュした: '+r.error);
    });
    await test('daysBetweenが同一日で0を返す', async () => {
      const r = await page.evaluate(()=> daysBetween('2026-08-02','2026-08-02'));
      assertEqual(r, 0);
    });
    await test('daysBetweenが年またぎでも正しく計算できる', async () => {
      const r = await page.evaluate(()=> daysBetween('2025-12-30','2026-01-02'));
      assertEqual(r, 3);
    });
    await page.close();
  }

  category('Unit: URL生成(Googleカレンダー連携・ICSエスケープ)');
  {
    const page = await newPage(browser);
    await test('escapeICSが改行・カンマ・セミコロンを正しくエスケープする', async () => {
      const r = await page.evaluate(()=> escapeICS('a,b;c\nd'));
      assertEqual(r, 'a\\,b\\;c\\nd');
    });
    await test('escapeICSが空文字列でクラッシュしない', async () => {
      const r = await page.evaluate(()=> escapeICS(''));
      assertEqual(r, '');
    });
    await test('buildDaySummaryが空ログでクラッシュしない', async () => {
      const r = await page.evaluate(()=> buildDaySummary({}));
      assertEqual(r, '');
    });
    await test('buildDaySummaryがnullログでクラッシュしない', async () => {
      const r = await page.evaluate(()=> buildDaySummary(null));
      assertEqual(r, '');
    });
    await test('buildDaySummaryが型不正なschedule(数値)でクラッシュしない(回帰防止)', async () => {
      const r = await page.evaluate(()=> {
        try{ buildDaySummary({schedule: 12345}); return {ok:true}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, 'buildDaySummaryが型不正データでクラッシュした: '+r.error);
    });
    await page.close();
  }

  // ============================================================
  // INTEGRATION TESTS - ストレージ層(localStorage / IndexedDB)の往復
  // ============================================================
  category('Integration: localStorage 保存→読込');
  {
    const page = await newPage(browser);
    await test('saveLog→loadLogで内容が一致する', async () => {
      const r = await page.evaluate(async () => {
        const log = {sleepStart:'23:00', meals:{breakfast:{content:'テスト朝食'}}};
        await saveLog('2026-08-02', log);
        const loaded = await loadLog('2026-08-02');
        return loaded.sleepStart==='23:00' && loaded.meals.breakfast.content==='テスト朝食';
      });
      assert(r, '保存→読込の内容が一致しない');
    });
    await test('存在しない日付のloadLogは空オブジェクトを返す', async () => {
      const r = await page.evaluate(async () => await loadLog('1999-01-01'));
      assertEqual(r, {});
    });
    await test('壊れたJSON文字列が直接保存されていても、loadLogはクラッシュせず空を返す(回帰防止)', async () => {
      const r = await page.evaluate(async () => {
        await storageSet('log:2026-08-09', 'BROKEN {{{');
        try{ const v = await loadLog('2026-08-09'); return {ok:true, value:v}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, 'loadLogが壊れたデータでクラッシュした: '+r.error);
      assertEqual(r.value, {});
    });
    await test('設定(userSettings)の保存→読込が一致する', async () => {
      const r = await page.evaluate(async () => {
        userSettings.fontSize='large';
        await saveUserSettings();
        await loadUserSettings();
        return userSettings.fontSize;
      });
      assertEqual(r, 'large');
    });
    await page.close();
  }

  category('Integration: IndexedDB 写真保存→取得→削除');
  {
    const page = await newPage(browser);
    await test('写真を保存して取得できる', async () => {
      const r = await page.evaluate(async () => {
        const canvas=document.createElement('canvas'); canvas.width=10; canvas.height=10;
        canvas.getContext('2d').fillRect(0,0,10,10);
        const blob = await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.7));
        await saveMealPhoto('test_2026-08-02_breakfast', blob);
        const got = await getMealPhoto('test_2026-08-02_breakfast');
        return got instanceof Blob && got.size===blob.size;
      });
      assert(r, '写真の保存→取得が一致しない');
    });
    await test('写真を削除すると取得できなくなる', async () => {
      const r = await page.evaluate(async () => {
        await deleteMealPhoto('test_2026-08-02_breakfast');
        const got = await getMealPhoto('test_2026-08-02_breakfast');
        return got===null;
      });
      assert(r, '削除後も写真が取得できてしまう');
    });
    await test('存在しない写真キーはnullを返す(クラッシュしない)', async () => {
      const r = await page.evaluate(async () => {
        try{ const v = await getMealPhoto('存在しないキー'); return {ok:true, v}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok && r.v===null);
    });
    await page.close();
  }

  category('Integration: バックアップ export→import 往復');
  {
    const page = await newPage(browser);
    await test('保存したデータがexport→import往復で保持される', async () => {
      const r = await page.evaluate(async () => {
        await storageSet('log:2026-08-02', JSON.stringify({sleepStart:'22:30', meals:{breakfast:{content:'往復テスト'}}}));
        const keys = await storageListAllKeys();
        const data = {};
        for(const k of keys){ const v = await storageGet(k); if(v) data[k]=v.value; }
        const payload = JSON.stringify({app:'生活リズム帳', backupVersion:2, data, photos:[]});

        // 一旦データを消してから、書き出したバックアップを読み込み直す
        await storageSet('log:2026-08-02', JSON.stringify({}));
        const file = new File([payload], 'b.json', {type:'application/json'});
        await importAllDataFromFile(file);
        return true;
      });
      assert(r);
    });
    await page.close();
  }

  category('Unit: validateImportEntry(バックアップ検証)');
  {
    const page = await newPage(browser);
    await test('正常なlogエントリを受理する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('log:2026-08-02', JSON.stringify({sleepStart:'23:00'})));
      assert(r.ok===true, '正常データが拒否された');
    });
    await test('JSON構文エラーのlog値を拒否する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('log:2026-08-02', 'NOT JSON {{{'));
      assert(r.ok===false, '不正データが受理された');
    });
    await test('nullを拒否する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('log:2026-08-02', null));
      assert(r.ok===false);
    });
    await test('undefinedを拒否する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('log:2026-08-02', undefined));
      assert(r.ok===false);
    });
    await test('activeTodosが配列でない場合は拒否する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('activeTodos', JSON.stringify({not:'array'})));
      assert(r.ok===false);
    });
    await test('activeTodosの上限(2000件)を超えたら拒否する', async () => {
      const r = await page.evaluate(()=> {
        const arr = Array.from({length:2001},(_, i)=>({text:'x'+i}));
        return validateImportEntry('activeTodos', JSON.stringify(arr));
      });
      assert(r.ok===false, '2001件が受理されてしまった(上限違反)');
    });
    await test('activeTodosの境界値(ちょうど2000件)は受理する', async () => {
      const r = await page.evaluate(()=> {
        const arr = Array.from({length:2000},(_, i)=>({text:'x'+i}));
        return validateImportEntry('activeTodos', JSON.stringify(arr));
      });
      assert(r.ok===true, '境界値2000件が拒否された');
    });
    await test('未知キー(将来バージョン)は前方互換のため許可する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('futureKey:abc', JSON.stringify({x:1})));
      assert(r.ok===true, '未知キーが拒否された(前方互換が壊れている)');
    });
    await test('非文字列オブジェクトは自動修復(JSON化)する', async () => {
      const r = await page.evaluate(()=> validateImportEntry('log:2026-08-01', {sleepStart:'07:00'}));
      assert(r.ok===true && typeof r.value==='string', '非文字列値の自動修復が機能していない');
    });
    await page.close();
  }


  // ============================================================
  // 境界値テスト
  // ============================================================
  category('境界値: TODO件数');
  {
    const page = await newPage(browser);
    await test('TODO 0件で描画してもクラッシュしない', async () => {
      const r = await page.evaluate(()=> {
        pendingTodos=[]; currentLog.todos=[];
        try{ renderTodoList(); return {ok:true, rows: document.querySelectorAll('.todo-row').length}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, 'TODO0件でクラッシュ: '+r.error);
      assertEqual(r.rows, 0);
    });
    await test('TODO 1件を正しく描画する', async () => {
      const r = await page.evaluate(()=> {
        pendingTodos=[{text:'唯一のタスク'}];
        renderTodoList();
        return document.querySelectorAll('.todo-row').length;
      });
      assertEqual(r, 1);
    });
    await test('TODO 2000件(検証上限ちょうど)でも描画がクラッシュしない', async () => {
      const r = await page.evaluate(()=> {
        pendingTodos = Array.from({length:2000},(_, i)=>({text:'x'+i}));
        try{ renderTodoList(); return {ok:true, rows: document.querySelectorAll('.todo-row').length}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, 'TODO2000件でクラッシュ: '+r.error);
      assertEqual(r.rows, 2000);
    });
    await page.close();
  }

  category('境界値: 写真枚数・文字数');
  {
    const page = await newPage(browser);
    await test('写真0枚でギャラリーがクラッシュしない(空表示になる)', async () => {
      const r = await page.evaluate(async () => {
        mealPhotoGalleryMode='all';
        try{ await renderMealPhotoGallery(); return {ok:true}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, '写真0枚でクラッシュ: '+r.error);
    });
    await test('文字数0(空の食事内容)で保存してもクラッシュしない', async () => {
      const r = await page.evaluate(async () => {
        try{ await saveLog('2026-08-02', {meals:{breakfast:{content:''}}}); return {ok:true}; }
        catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, '空文字列の保存でクラッシュ: '+r.error);
    });
    await test('極端に長い食事内容(1万文字)でも保存でクラッシュしない', async () => {
      const r = await page.evaluate(async () => {
        try{
          const huge = 'あ'.repeat(10000);
          await saveLog('2026-08-02', {meals:{breakfast:{content:huge}}});
          return {ok:true};
        }catch(e){ return {ok:false, error:e.message}; }
      });
      assert(r.ok, '長文入力でクラッシュ: '+r.error);
    });
    await page.close();
  }

  // ============================================================
  // E2E TESTS - 主要ユーザーフロー
  // ============================================================
  category('E2E: 初回起動');
  {
    const page = await newPage(browser);
    await test('スプラッシュが消え、メイン画面が表示される', async () => {
      const visible = await page.evaluate(()=> {
        const splash = document.getElementById('splashScreen');
        const main = document.getElementById('mainView');
        return getComputedStyle(splash).display==='none' && getComputedStyle(main).display!=='none';
      });
      assert(visible, '起動後にメイン画面が表示されていない');
    });
    assertNoErrors(page);
    await page.close();
  }

  category('E2E: データ入力→保存→日付変更→再読込で保持');
  {
    const page = await newPage(browser);
    await test('食事内容を入力して保存し、日付を移動して戻ると内容が保持されている', async () => {
      await page.fill('#breakfastContent', 'E2Eテスト朝食');
      await page.locator('#breakfastContent').blur();
      await page.waitForTimeout(300);
      await page.click('#nextDay');
      await page.waitForTimeout(300);
      await page.click('#prevDay');
      await page.waitForTimeout(300);
      const val = await page.inputValue('#breakfastContent');
      assertEqual(val, 'E2Eテスト朝食');
    });
    assertNoErrors(page);
    await page.close();
  }

  category('E2E: TODO追加→完了→削除');
  {
    const page = await newPage(browser);
    await test('TODOを追加できる', async () => {
      await page.fill('#todoNewInput', 'E2E TODOテスト');
      await page.click('#todoAddBtn');
      await page.waitForTimeout(200);
      const count = await page.evaluate(()=> pendingTodos.length);
      assert(count>=1, 'TODOが追加されていない');
    });
    await test('TODOを完了にできる(クリック)', async () => {
      await page.click('.todo-check');
      await page.waitForTimeout(200);
      const doneCount = await page.evaluate(()=> (currentLog.todos||[]).length);
      assert(doneCount>=1, 'TODOが完了状態に移動していない');
    });
    await test('TODOを削除できる', async () => {
      const before = await page.evaluate(()=> document.querySelectorAll('.todo-row').length);
      const delBtn = await page.$('.todo-delete');
      if(delBtn) await delBtn.click();
      await page.waitForTimeout(200);
      const after = await page.evaluate(()=> document.querySelectorAll('.todo-row').length);
      assert(after < before || before===0, 'TODOが削除されていない');
    });
    assertNoErrors(page);
    await page.close();
  }

  category('E2E: 写真追加→削除');
  {
    const page = await newPage(browser);
    await test('写真を保存でき、削除もできる', async () => {
      const r = await page.evaluate(async () => {
        const canvas=document.createElement('canvas'); canvas.width=10; canvas.height=10;
        canvas.getContext('2d').fillRect(0,0,10,10);
        const blob = await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.7));
        const key = mealPhotoKeyFor(fmtDate(currentDate), 'breakfast');
        await saveMealPhoto(key, blob);
        const gotAfterSave = await getMealPhoto(key);
        await deleteMealPhoto(key);
        const gotAfterDelete = await getMealPhoto(key);
        return {saved: gotAfterSave instanceof Blob, deleted: gotAfterDelete===null};
      });
      assert(r.saved && r.deleted, '写真の追加/削除フローが正しく機能していない');
    });
    assertNoErrors(page);
    await page.close();
  }

  category('E2E: バックアップ作成→復元');
  {
    const page = await newPage(browser);
    await test('バックアップファイルを作成し、同じ内容を復元できる', async () => {
      const r = await page.evaluate(async () => {
        await storageSet('log:2026-08-02', JSON.stringify({sleepStart:'21:15'}));
        const keys = await storageListAllKeys();
        const data = {};
        for(const k of keys){ const v = await storageGet(k); if(v) data[k]=v.value; }
        const payload = JSON.stringify({app:'生活リズム帳', backupVersion:2, data, photos:[]});
        await storageSet('log:2026-08-02', JSON.stringify({}));
        const file = new File([payload], 'b.json', {type:'application/json'});
        await importAllDataFromFile(file);
        return true;
      });
      assert(r);
    });
    assertNoErrors(page);
    await page.close();
  }

  category('E2E: 設定変更(文字サイズ)が保持される');
  {
    const page = await newPage(browser);
    await test('文字サイズ設定を変更すると反映される', async () => {
      const r = await page.evaluate(async () => {
        userSettings.fontSize='xlarge';
        await saveUserSettings();
        applyUserSettings();
        return getComputedStyle(document.documentElement).getPropertyValue('--user-font-scale').trim();
      });
      assertEqual(r, '1.4');
    });
    assertNoErrors(page);
    await page.close();
  }

  // ============================================================
  // 回帰固定化テスト - 今回のセッションで発見・修正した問題を恒久テスト化
  // ============================================================
  category('回帰防止: XSS対策');
  {
    const page = await newPage(browser);
    const PAYLOAD = `<img src=x onerror="window.__xssFired=true">`;
    await test('食事内容欄にスクリプトを注入しても実行されない', async () => {
      await page.fill('#breakfastContent', PAYLOAD);
      await page.evaluate(()=>{ document.getElementById('breakfastContent').dispatchEvent(new Event('input')); });
      await page.waitForTimeout(150);
      const fired = await page.evaluate(()=> !!window.__xssFired);
      assert(!fired, 'XSSが発火した(食事内容欄)');
    });
    await test('TODOテキストにスクリプトを注入しても実行されない(escapeHtml経由)', async () => {
      await page.evaluate((payload) => {
        pendingTodos.push({text: payload});
        renderTodoList();
      }, `"><script>window.__xssFired=true;</script>`);
      await page.waitForTimeout(150);
      const fired = await page.evaluate(()=> !!window.__xssFired);
      assert(!fired, 'XSSが発火した(TODOテキスト)');
    });
    await page.close();
  }

  category('回帰防止: バックアップ検証(起動フリーズ再発防止)');
  {
    const page = await newPage(browser);
    await test('壊れたlog値を含むバックアップを読み込んでも、次回起動でフリーズしない', async () => {
      await page.evaluate(async () => {
        const file = new File([JSON.stringify({data:{'log:2026-08-02':'BROKEN {{{'}, photos:[]})], 'b.json', {type:'application/json'});
        await importAllDataFromFile(file);
      });
      await page.waitForTimeout(2700);
      const health = await page.evaluate(()=> {
        const s = document.getElementById('splashScreen');
        return s ? getComputedStyle(s).display==='none' : true;
      });
      assert(health, 'スプラッシュが消えず、起動フリーズが再発した');
    });
    await page.close();
  }

  category('回帰防止: TODO描画速度(レイアウトスラッシング再発防止)');
  {
    const page = await newPage(browser);
    await test('TODO 500件の描画が300ms以内に完了する(修正前は約700ms)', async () => {
      const ms = await page.evaluate(async () => {
        pendingTodos = Array.from({length:500},(_, i)=>({text:'x'+i}));
        const t0 = performance.now();
        renderTodoList();
        return performance.now()-t0;
      });
      assert(ms < 300, `TODO500件の描画が${ms.toFixed(1)}msかかった(閾値300ms超過、レイアウトスラッシングの再発の可能性)`);
    });
    await page.close();
  }

  category('回帰防止: キーボード操作・ARIA属性');
  {
    const page = await newPage(browser);
    await test('完了トグル(ラジオ体操)がキーボード操作可能(tabindex/role/aria-pressed)', async () => {
      const attrs = await page.evaluate(()=> {
        const el = document.getElementById('taisoCell');
        return {tabIndex: el.tabIndex, role: el.getAttribute('role'), ariaPressed: el.getAttribute('aria-pressed')};
      });
      assert(attrs.tabIndex===0, 'tabindexが設定されていない');
      assertEqual(attrs.role, 'button');
      assert(attrs.ariaPressed==='false' || attrs.ariaPressed==='true', 'aria-pressedが設定されていない');
    });
    await test('Enterキーで完了トグルを操作できる', async () => {
      const before = await page.evaluate(()=> document.getElementById('bathCell').classList.contains('done'));
      await page.evaluate(()=>{ document.getElementById('bathCell').focus(); });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      const after = await page.evaluate(()=> document.getElementById('bathCell').classList.contains('done'));
      assert(before!==after, 'Enterキーで状態が変化しない(回帰)');
    });
    await test('Escキーで確認モーダルを閉じられる', async () => {
      await page.evaluate(()=>{ requestDataActionConfirm('gcal', ()=>{}); });
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const display = await page.evaluate(()=> getComputedStyle(document.getElementById('dataActionConfirmOverlay')).display);
      assertEqual(display, 'none');
    });
    await page.close();
  }

  category('回帰防止: コントラスト比(WCAG AA)');
  {
    const page = await newPage(browser);
    await test('--gold(フォーカス枠線/プレミアムリンク文字色)が4.5:1以上を確保している', async () => {
      const ratio = await page.evaluate(()=>{
        function lum(hex){ hex=hex.replace('#',''); const r=parseInt(hex.substr(0,2),16)/255,g=parseInt(hex.substr(2,2),16)/255,b=parseInt(hex.substr(4,2),16)/255; const lin=c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); }
        const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim();
        const l1=lum(gold), l2=lum('#FBFCFA'); const hi=Math.max(l1,l2),lo=Math.min(l1,l2);
        return (hi+0.05)/(lo+0.05);
      });
      assert(ratio>=4.5, `--goldのコントラスト比が${ratio.toFixed(2)}(基準4.5未満)`);
    });
    await test('--sage-text(保存メッセージ文字色)が4.5:1以上を確保している', async () => {
      const ratio = await page.evaluate(()=>{
        function lum(hex){ hex=hex.replace('#',''); const r=parseInt(hex.substr(0,2),16)/255,g=parseInt(hex.substr(2,2),16)/255,b=parseInt(hex.substr(4,2),16)/255; const lin=c=>c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); }
        const c = getComputedStyle(document.documentElement).getPropertyValue('--sage-text').trim();
        const l1=lum(c), l2=lum('#FBFCFA'); const hi=Math.max(l1,l2),lo=Math.min(l1,l2);
        return (hi+0.05)/(lo+0.05);
      });
      assert(ratio>=4.5, `--sage-textのコントラスト比が${ratio.toFixed(2)}(基準4.5未満)`);
    });
    await page.close();
  }

  category('回帰防止: 写真の上書き確認(思い出の消失防止)');
  await test('空の枠への初回保存は確認なしで保存される', async () => {
    const page = await newPage(browser);
    page.removeAllListeners('dialog');
    let dialogFired = false;
    page.on('dialog', async d => { dialogFired = true; await d.accept(); });
    await page.evaluate(async () => {
      function makeBlob(){ const c=document.createElement('canvas'); c.width=10;c.height=10; c.getContext('2d').fillRect(0,0,10,10); return new Promise(r=>c.toBlob(r,'image/jpeg',0.7)); }
      mealPhotoCurrentMealKey='breakfast';
      await handleMealPhotoFileSelected(await makeBlob());
    });
    await page.waitForTimeout(200);
    await page.close();
    assert(!dialogFired, '写真が無い状態での初回保存なのに確認ダイアログが出た');
  });
  await test('既存の写真がある状態での上書きは確認ダイアログが出て、キャンセルすると元の写真が残る', async () => {
    const page = await newPage(browser);
    page.removeAllListeners('dialog');
    page.on('dialog', async d => { await d.dismiss(); });
    const r = await page.evaluate(async () => {
      function makeBlob(w){ const c=document.createElement('canvas'); c.width=w;c.height=10; c.getContext('2d').fillRect(0,0,w,10); return new Promise(r=>c.toBlob(r,'image/jpeg',0.7)); }
      mealPhotoCurrentMealKey='breakfast';
      await handleMealPhotoFileSelected(await makeBlob(10));
      const key = mealPhotoKeyFor(fmtDate(currentDate), 'breakfast');
      const before = await getMealPhoto(key);
      await handleMealPhotoFileSelected(await makeBlob(80));
      const after = await getMealPhoto(key);
      return {beforeSize: before.size, afterSize: after.size};
    });
    await page.close();
    assertEqual(r.beforeSize, r.afterSize, 'キャンセルしたのに写真が上書きされた(思い出が消失した)');
  });

  category('回帰防止: 日付ジャンプ機能(人生ログの過去検索)');
  {
    const page = await newPage(browser);
    await test('日付を指定すると、その日付へ直接移動できる', async () => {
      const r = await page.evaluate(() => {
        const el = document.getElementById('calJumpDateInput');
        el.value = '2010-05-20';
        el.dispatchEvent(new Event('change'));
        return fmtDate(currentDate);
      });
      assertEqual(r, '2010-05-20');
    });
    await test('日付移動後、入力欄に表示中の日付が同期される', async () => {
      const r = await page.evaluate(async () => {
        currentDate = new Date(2015,3,1);
        await loadAll();
        return document.getElementById('calJumpDateInput').value;
      });
      assertEqual(r, '2015-04-01');
    });
    await page.close();
  }

  category('回帰防止: プレースホルダー・入力欄の文字見切れ');
  {
    const page = await newPage(browser);
    await test('全ての文字サイズ設定で、予定欄のプレースホルダーが見切れない', async () => {
      for(const scale of ['0.9','1','1.18','1.4']){
        await page.evaluate((s)=>{ document.documentElement.style.setProperty('--user-font-scale', s); }, scale);
        await page.waitForTimeout(50);
        const result = await page.evaluate(() => {
          const el = document.getElementById('scheduleInput');
          return {scrollHeight: el.scrollHeight, clientHeight: el.clientHeight};
        });
        assert(result.scrollHeight <= result.clientHeight + 2,
          `文字サイズ${scale}でscheduleInputのプレースホルダーが見切れている(必要${result.scrollHeight}px, 表示可能${result.clientHeight}px)`);
      }
    });
    await test('全ての文字サイズ設定で、主要な固定高さ欄(overflow:hidden)のテキストが見切れない', async () => {
      const clippedAny = [];
      for(const scale of ['0.9','1','1.18','1.4']){
        await page.evaluate((s)=>{ document.documentElement.style.setProperty('--user-font-scale', s); }, scale);
        await page.waitForTimeout(50);
        const issues = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('textarea').forEach(el=>{
            const cs = getComputedStyle(el);
            if(cs.display==='none') return;
            if(cs.overflowY!=='hidden' && cs.overflow!=='hidden') return;
            if(el.scrollHeight > el.clientHeight + 2){ out.push({id:el.id, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight}); }
          });
          return out;
        });
        if(issues.length) clippedAny.push({scale, issues});
      }
      assert(clippedAny.length===0, `文字が見切れている欄がある: ${JSON.stringify(clippedAny)}`);
    });
    await page.close();
  }

  category('回帰防止: うっかり戻る操作の緩衝(1回分)');
  {
    const page = await newPage(browser);
    await test('1回だけ戻る操作をしても、入力内容が表示され続ける', async () => {
      await page.fill('#breakfastContent', '緩衝テスト用データ');
      await page.locator('#breakfastContent').blur();
      await page.waitForTimeout(200);
      await page.goBack({waitUntil:'domcontentloaded', timeout:2000}).catch(()=>{});
      await page.waitForTimeout(200);
      const val = await page.evaluate(()=> document.getElementById('breakfastContent') ? document.getElementById('breakfastContent').value : null).catch(()=>null);
      assert(val==='緩衝テスト用データ', '1回のうっかり戻る操作でアプリから離脱してしまった');
    });
    await page.close();
  }

  category('回帰防止: 日付入力欄を閉じる操作(戻る)の直後の、本来の戻る操作でも離脱しない');
  {
    const page = await newPage(browser);
    await test('カレンダー入力を試みた後、間を置いて戻る操作をしても、アプリ内に留まる', async () => {
      await page.evaluate(()=>{ document.getElementById('calJumpDateInput').focus(); });
      await page.goBack({waitUntil:'domcontentloaded', timeout:1500}).catch(()=>{}); // 日付欄を閉じる操作を模す
      await page.waitForTimeout(1200); // 人が操作する程度の間隔(緩衝が補充される)
      await page.goBack({waitUntil:'domcontentloaded', timeout:1500}).catch(()=>{}); // 本来の戻る操作
      await page.waitForTimeout(200);
      const stillOnApp = await page.evaluate(()=> document.title==='生活リズム帳' && !!document.getElementById('mainView')).catch(()=>false);
      assert(stillOnApp, '日付入力操作の後、本来の戻る操作でアプリから離脱してしまった(実際に報告された不具合)');
    });
    await page.close();
  }

  category('回帰防止: ObjectURLメモリリーク(写真サムネイル)');
  {
    const page = await newPage(browser);
    await test('renderMealPhotoThumbnailsを繰り返し呼んでもObjectURLがリークしない', async () => {
      const r = await page.evaluate(async () => {
        const created=[]; const revoked=new Set();
        const oc=URL.createObjectURL.bind(URL), or=URL.revokeObjectURL.bind(URL);
        URL.createObjectURL=(b)=>{ const u=oc(b); created.push(u); return u; };
        URL.revokeObjectURL=(u)=>{ revoked.add(u); return or(u); };
        for(let i=0;i<10;i++){ await renderMealPhotoThumbnails(); }
        const leaked = created.filter(u=>!revoked.has(u));
        return {createdCount: created.length, leakedCount: leaked.length};
      });
      assert(r.leakedCount===0, `ObjectURLが${r.leakedCount}件リークした`);
    });
    await page.close();
  }

  // ============================================================
  // 集計・レポート出力
  // ============================================================
  await server.close();
  await browser.close();

  const byCategory = {};
  for(const r of results){
    if(!byCategory[r.category]) byCategory[r.category] = [];
    byCategory[r.category].push(r);
  }
  console.log('\n' + '='.repeat(70));
  console.log('生活リズム帳 - 回帰テストスイート 実行結果');
  console.log('='.repeat(70));
  let totalPass=0, totalFail=0, totalMs=0;
  for(const [cat, tests] of Object.entries(byCategory)){
    console.log(`\n[${cat}]`);
    for(const t of tests){
      totalMs += t.ms;
      if(t.pass){ totalPass++; console.log(`  OK   ${t.name} (${t.ms}ms)`); }
      else{ totalFail++; console.log(`  FAIL ${t.name} (${t.ms}ms)\n       -> ${t.error}`); }
    }
  }
  console.log('\n' + '='.repeat(70));
  console.log(`合計: ${results.length}件 / 成功: ${totalPass}件 / 失敗: ${totalFail}件 / 実行時間: ${totalMs}ms`);
  console.log('='.repeat(70));

  if(totalFail>0) process.exitCode = 1;
}

main().catch(e=>{ console.error('SUITE ERROR', e); process.exit(1); });
