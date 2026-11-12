'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// 真实 Electron 渲染环境跑京东登录页页签场景：停在扫码页签时先切页签再填写。
test('京东登录页停在扫码/短信页签时先切密码登录再填写', () => {
  const env = { ...process.env };
  // bash 环境可能带 ELECTRON_RUN_AS_NODE，会让 electron.exe 变成纯 Node
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    [path.join(__dirname, 'jd-login-tab-switch.cjs')],
    { encoding: 'utf8', timeout: 120000, env }
  );
  const lines = String(result.stdout || '').trim().split('\n').filter(Boolean);
  const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  assert.equal(result.status, 0, 'Electron 场景脚本执行失败：' + (last?.error || result.stderr || ''));
  assert.deepEqual(last, { ok: true });
});
