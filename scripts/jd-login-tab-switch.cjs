'use strict';
// 京东登录页「扫码/短信页签」场景的真实 DOM 验证（Electron 渲染真实页面，不用 jsdom 猜）。
// 页面用 data: URL 合成，因此把域名判定替换成固定的 passport.jd.com，
// 只检验页签识别、点击与账号密码填写顺序，不改变生产代码的信任域判断。
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { jdPage } = require('../electron/promotion-fee-jd.cjs');

// 合成京东 passport 登录页：默认停在「扫码登录」，点「账号密码登录」才显示表单。
function page(formHidden = true, withPasswordTab = true) {
  return `<!doctype html><html><body>
  <div id="tabs"><span id="qr">扫码登录</span>${withPasswordTab ? '<span id="pw">账号密码登录</span>' : '<span id="sms">短信登录</span>'}</div>
  <form id="f" action="https://passport.jd.com/new/login.aspx" ${formHidden ? 'style="display:none"' : ''}>
    <input id="loginname" type="text" placeholder="账号">
    <input id="nloginpwd" type="password" placeholder="密码">
    <button id="paipaiLoginSubmit">登录</button>
  </form>
  <script>
   window.__submitted=false;
   document.getElementById('pw')?.addEventListener('click',()=>{document.getElementById('f').style.display='block';});
   document.getElementById('paipaiLoginSubmit').addEventListener('click',e=>{e.preventDefault();window.__submitted=true;});
  </script></body></html>`;
}

// 生产源码里的信任域判定替换为固定 passport.jd.com（仅测试副本）
function testSource() {
  const original = jdPage.toString();
  const guard = "if(location.protocol!=='https:'||!(location.hostname==='jd.com'||location.hostname.endsWith('.jd.com')))return {status:'untrusted'};";
  assert.ok(original.includes(guard), '生产源码的信任域判定已变化，测试副本需要同步');
  return original.replace(guard, '').replace(/location\.hostname/g, "'passport.jd.com'");
}

async function run() {
  const source = testSource();
  const win = new BrowserWindow({ show: false, width: 1100, height: 800 });
  const load = async html => {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return script => win.webContents.executeJavaScript(script);
  };
  try {
    // 1. 只探测：页面停在扫码页签时，必须报告「这是登录表单」，且不许自己点页签
    let evaluate = await load(page(true));
    const probe = await evaluate('(' + source + ')({})');
    assert.equal(probe.status, 'form', '停在扫码页签也要识别为登录页');
    assert.equal(probe.loginHost, 'passport.jd.com');
    assert.equal(await evaluate("document.getElementById('f').style.display"), 'none', '探测阶段不得点击页签');

    // 2. 带账号密码填充：先切「账号密码登录」页签，本轮返回 switched
    const switched = await evaluate('(' + source + ')({credentials:{username:"test-user",password:"test-pass"}})');
    assert.equal(switched.status, 'switched', '页签未切换时先返回 switched');
    assert.equal(await evaluate("document.getElementById('f').style.display"), 'block', '切页签后表单必须可见');

    // 3. 页签已切换：分阶段填写，账号阶段只写账号、密码阶段只写密码
    const usernameStage = await evaluate('(' + source + ')({credentials:{username:"test-user",password:"test-pass",stage:"username"}})');
    assert.equal(usernameStage.status, 'prepared');
    assert.equal(await evaluate("document.getElementById('loginname').value"), 'test-user');
    const passwordStage = await evaluate('(' + source + ')({credentials:{username:"test-user",password:"test-pass",stage:"password"}})');
    assert.equal(passwordStage.status, 'prepared');
    assert.equal(await evaluate("document.getElementById('nloginpwd').value"), 'test-pass', '密码阶段必须写入密码');

    // 4. 提交阶段：点击登录按钮，页面收到提交
    const submitStage = await evaluate('(' + source + ')({credentials:{username:"test-user",password:"test-pass",stage:"submit"}})');
    assert.equal(submitStage.status, 'submitted');
    assert.equal(await evaluate('window.__submitted'), true, '提交阶段必须真的触发登录按钮');

    // 5. 只有短信登录、没有密码登录页签时不能谎报 form（否则会一直空等）
    evaluate = await load(page(true, false));
    const smsOnly = await evaluate('(' + source + ')({})');
    assert.notEqual(smsOnly.status, 'form', '没有密码登录页签时不得报告为可填写表单');

    // 6. 表单一开始就可见（旧版页面）：不应再点任何页签，直接填写
    evaluate = await load(page(false));
    const direct = await evaluate('(' + source + ')({credentials:{username:"test-user",password:"test-pass",stage:"username"}})');
    assert.equal(direct.status, 'prepared', '表单已可见时直接填写');
    assert.equal(await evaluate("document.getElementById('loginname').value"), 'test-user');
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    await run();
    process.stdout.write(JSON.stringify({ ok: true }) + '\n');
    app.exit(0);
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message || error) }) + '\n');
    app.exit(1);
  }
});
