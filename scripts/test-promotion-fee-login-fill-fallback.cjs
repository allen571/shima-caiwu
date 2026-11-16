'use strict';
// 淘宝/天猫推广费登录：原生逐字输入依赖窗口焦点，批量登录时可能静默失败（返回 manual）。
// v1.2.81（2026-11-10 财务反馈「弹窗后账号密码经常没写入」）改为：
//   ① 有密码框且密码为空、且账号框不是别人账号 → DOM 强制写入并回读校验；
//   ② 两框都已填、只差点提交 → DOM 直接提交；
//   ③ 账号框里是别的账号 / 密码已填 → 一律保持 manual，不覆盖用户手输内容。
const test = require('node:test'), assert = require('node:assert/strict');
const { PromotionFee } = require('../electron/promotion-fee.cjs');
const nativeLogin = require('../electron/native-login.cjs');

const LOGIN_URL = 'https://login.taobao.com/member/login.jhtml';

function harness({ empty = false, usernameFilled = !empty, usernameMatches = usernameFilled, passwordFilled = usernameFilled } = {}) {
  const scripts = [];
  const frame = { url: LOGIN_URL, parent: null };
  const wc = { mainFrame: { framesInSubtree: [frame] }, getURL: () => LOGIN_URL };
  const win = { webContents: wc };
  let state = { hasPassword: true, hasUsername: true, passwordFilled, usernameFilled, usernameMatches };
  const host = {
    assertWindow: () => wc,
    check: () => {},
    readPage: async () => { throw Error('不应走只读 readPage'); },
    execute: async (_win, script) => {
      scripts.push(script);
      if (script.includes('usernameMatches')) return { ...state };      // 表单探测（只回布尔）
      if (script.includes('loginPage')) {                                // DOM 强制写入
        state = { hasPassword: true, hasUsername: true, passwordFilled: true, usernameFilled: true, usernameMatches: true };
        return /"fillOnly\\?":true/.test(script) ? { status: 'filled' } : { status: 'submitted' };
      }
      return true;
    }
  };
  return { host, win, scripts };
}

function callAuthState(host, win, credentials) {
  return PromotionFee.prototype.authState.call(host, win, credentials);
}
const lastInjection = scripts => [...scripts].reverse().find(script => script.includes('loginPage'));

test('原生输入失败且两框为空时退回 DOM 预填，保留仅预填语义', async () => {
  const original = nativeLogin.operate;
  nativeLogin.operate = async () => ({ status: 'manual' });
  try {
    const { host, win, scripts } = harness({ empty: true });
    const result = await callAuthState(host, win, { username: 'test-user', password: 'test-pass', fillOnly: true });
    assert.equal(result.status, 'filled', '应当退回 DOM 预填并报告已填写');
    const last = lastInjection(scripts);
    assert.ok(last, '必须注入过 DOM 填写脚本');
    assert.match(last, /"fillOnly":true/, '仅预填语义必须保留，不能擅自提交');
  } finally { nativeLogin.operate = original; }
});

test('原生输入失败且账号框已被淘宝记住（就是本店账号）时补填密码', async () => {
  const original = nativeLogin.operate;
  nativeLogin.operate = async () => ({ status: 'manual' });
  try {
    const { host, win, scripts } = harness({ usernameFilled: true, usernameMatches: true, passwordFilled: false });
    const result = await callAuthState(host, win, { username: 'test-user', password: 'test-pass', fillOnly: true });
    assert.equal(result.status, 'filled', '账号是配置的那个就不该挡住补填密码');
    assert.ok(lastInjection(scripts), '必须注入过 DOM 填写脚本');
  } finally { nativeLogin.operate = original; }
});

test('原生输入失败且字段为空时，正常登录仍可走 DOM 提交', async () => {
  const original = nativeLogin.operate;
  nativeLogin.operate = async () => ({ status: 'manual' });
  try {
    const { host, win, scripts } = harness({ empty: true });
    await callAuthState(host, win, { username: 'test-user', password: 'test-pass' });
    const last = lastInjection(scripts);
    assert.match(last, /submit\.click\(\)|login-btn/, '正常登录路径的 DOM 兜底应当提交表单');
  } finally { nativeLogin.operate = original; }
});

test('账号框里是别的账号时保持 manual，不覆盖也不填密码', async () => {
  const original = nativeLogin.operate;
  nativeLogin.operate = async () => ({ status: 'manual' });
  try {
    const { host, win, scripts } = harness({ usernameFilled: true, usernameMatches: false, passwordFilled: false });
    const result = await callAuthState(host, win, { username: 'test-user', password: 'test-pass' });
    assert.equal(result.status, 'manual');
    assert.equal(lastInjection(scripts), undefined, '不得注入填写脚本');
  } finally { nativeLogin.operate = original; }
});

test('字段已有值时保持 manual，不覆盖用户已填内容', async () => {
  const original = nativeLogin.operate;
  nativeLogin.operate = async () => ({ status: 'manual' });
  try {
    const { host, win, scripts } = harness({ empty: false, usernameFilled: true, usernameMatches: true, passwordFilled: true });
    const result = await callAuthState(host, win, { username: 'test-user', password: 'test-pass' });
    assert.equal(result.status, 'manual');
    assert.equal(lastInjection(scripts), undefined, '不得注入填写脚本');
  } finally { nativeLogin.operate = original; }
});

test('原生输入成功时不额外注入 DOM 填写', async () => {
  const original = nativeLogin.operate;
  nativeLogin.operate = async () => ({ status: 'submitted' });
  try {
    const { host, win, scripts } = harness({ empty: true });
    const result = await callAuthState(host, win, { username: 'test-user', password: 'test-pass' });
    assert.equal(result.status, 'submitted');
    assert.equal(scripts.length, 0, '原生成功时不应再有额外脚本');
  } finally { nativeLogin.operate = original; }
});

test('未知检查点预填禁止强制覆盖已填字段或通过 DOM 提交',async()=>{
 const original=nativeLogin.operate;nativeLogin.operate=async()=>({status:'manual'});
 try{for(const values of [{empty:true},{usernameFilled:true,usernameMatches:true,passwordFilled:false},{usernameFilled:true,passwordFilled:true}]){
  const {host,win,scripts}=harness(values);const result=await callAuthState(host,win,{username:'test-user',password:'test-pass',fillOnly:true,noForce:true});
  assert.equal(result.status,'manual');assert.equal(lastInjection(scripts),undefined);
 }}finally{nativeLogin.operate=original;}
});
