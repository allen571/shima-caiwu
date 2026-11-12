'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const XLSX = require('../vendor/xlsx.full.min.js');
const { parseAccountWorkbook, parseAccountsFromFile, splitShopName } = require('../electron/promotion-fee-excel.cjs');
const { importAccounts, transferAccounts } = require('../electron/promotion-fee-accounts.cjs');

// 构造工作簿，避免测试依赖桌面上的真实账号表
function book(rows, sheetName = '账号') {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return workbook;
}

// 最小可用的服务替身：只覆盖导入路径会碰到的字段与加密调用
function fakeService(shops = []) {
  const calls = [];
  return {
    calls,
    busy: false,
    loginBusy: false,
    singleShop: false,
    data: { version: 1, shops, results: [] },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: value => { calls.push(['encrypt', value]); return Buffer.from('sealed:' + value); }
    },
    save(data) { this.data = data; }
  };
}

test('客服早晚班双列表不是财务账号表：只认单值账号列', () => {
  // 只有早班/晚班两列的客服排班台账 → 直接拒绝，不替用户猜用哪一列
  assert.throws(() => parseAccountWorkbook(book([
    ['平台', '早班客服账号', '晚班客服账号', '密码'],
    ['淘天', '示例淘天商城:客服甲', '示例淘天商城:客服乙', 'test-taobao-pass'],
    ['京东', '示例京东甲店-客服甲', '示例京东甲店-客服乙', 'test-jd-pass']
  ])), /未识别到表头/);
  // 财务表里即使并排放着客服列，也只导账号列，不会多导一条
  const parsed = parseAccountWorkbook(book([
    ['平台', '店铺账号', '早班客服账号', '晚班客服账号', '密码'],
    ['淘天', '示例淘天旗舰店:finance-test', '示例淘天商城:客服甲', '示例淘天商城:客服乙', 'test-taobao-pass']
  ]));
  assert.deepEqual(parsed.accounts, [
    { platform: 'taobao', username: '示例淘天旗舰店:finance-test', password: 'test-taobao-pass', name: '示例淘天旗舰店' }
  ]);
  assert.deepEqual(parsed.notes, []);
});

test('平台/账号/密码 三列表：表头别名、平台别名与脏数据清洗', () => {
  const parsed = parseAccountWorkbook(book([
    ['店铺平台', '登录账号', '密码'],
    ['淘天', '  示例淘天商城：客服甲  ', 'test-taobao-pass'],
    ['天猫', '天猫店:乙', 12345678],
    ['京准通', '示例京东甲店-客服甲', 'test-jd-pass'],
    ['抖店', '抖音店:丙', 'dy123'],
    ['拼多多', '某店:某客服', 'x123'],
    ['淘宝', '无密码店:甲', ''],
    ['', '', '']
  ]));
  assert.deepEqual(parsed.accounts.map(a => [a.platform, a.username, a.password]), [
    ['taobao', '示例淘天商城:客服甲', 'test-taobao-pass'],
    ['tmall', '天猫店:乙', '12345678'],
    ['jd', '示例京东甲店-客服甲', 'test-jd-pass'],
    ['douyin', '抖音店:丙', 'dy123']
  ], '全角冒号、首尾空格、数字密码都要归一，未知平台与空密码不计入');
  assert.deepEqual(parsed.invalid, [
    { row: 6, reason: '平台「拼多多」暂不支持' },
    { row: 7, reason: '密码为空' }
  ]);
  assert.equal(parsed.emptyRows, 1);
  assert.equal(parsed.totalRows, 7);
});

test('平台列合并留空时沿用上一行平台', () => {
  const parsed = parseAccountWorkbook(book([
    ['平台', '账号', '密码'],
    ['京东', '示例京东甲店-客服甲', 'test-jd-pass'],
    ['', '示例京东乙店-客服乙', 'test-jd-pass'],
    ['淘天', '示例淘天乙店:客服丙', 'test-other-pass']
  ]));
  assert.deepEqual(parsed.accounts.map(a => a.platform), ['jd', 'jd', 'taobao']);
});

test('xlsx、xls、csv 三种格式解析结果一致', () => {
  const rows = [['平台', '账号', '密码'], ['淘天', '示例淘天商城:客服甲', 'test-taobao-pass'], ['京东', '示例京东甲店-客服甲', 'test-jd-pass']];
  const workbook = book(rows);
  const expected = { taobao: '示例淘天商城:客服甲', jd: '示例京东甲店-客服甲' };
  for (const [bookType, file] of [['xlsx', '账号.xlsx'], ['biff8', '账号.xls']]) {
    const parsed = parseAccountsFromFile(XLSX.write(workbook, { type: 'buffer', bookType }), file);
    assert.deepEqual(Object.fromEntries(parsed.accounts.map(a => [a.platform, a.username])), expected, file + ' 解析结果不符');
  }
  const csv = Buffer.from('\ufeff平台,账号,密码\n淘天,示例淘天商城:客服甲,test-taobao-pass\n京东,示例京东甲店-客服甲,test-jd-pass\n', 'utf8');
  assert.deepEqual(Object.fromEntries(parseAccountsFromFile(csv, '账号.csv').accounts.map(a => [a.platform, a.username])), expected);
});

test('表内重复账号只保留一条', () => {
  const parsed = parseAccountWorkbook(book([
    ['平台', '账号', '密码'],
    ['淘天', '示例淘天商城:客服甲', 'test-taobao-pass'],
    ['淘天', ' 示例淘天商城:客服甲 ', 'test-taobao-pass']
  ]));
  assert.equal(parsed.accounts.length, 1);
});

test('缺表头或缺必需列时明确报错，不猜测导入', () => {
  assert.throws(() => parseAccountWorkbook(book([['店铺', '用户名'], ['x', 'y']])), /未识别到表头/);
  assert.throws(() => parseAccountWorkbook(book([['账号', '密码'], ['a', 'b']])), /未找到平台列/);
  assert.throws(() => parseAccountsFromFile(Buffer.alloc(0), '空.xlsx'), /表格文件为空/);
});

test('店铺名优先取独立列，拆不出分隔符时退回账号', () => {
  assert.equal(splitShopName('示例淘天商城:客服甲'), '示例淘天商城');
  assert.equal(splitShopName('示例京东甲店-客服甲'), '示例京东甲店');
  assert.equal(splitShopName('synthetic-user'), 'synthetic-user');
  assert.equal(splitShopName('tb-abc:某人'), 'tb-abc', '带连字符的账号仍按冒号拆分');
  assert.equal(splitShopName('示例淘天商城:客服甲', '示例淘天旗舰店'), '示例淘天旗舰店');
});

test('导入落库：保留店铺名、密码走系统加密、与已有账号去重', () => {
  const service = fakeService([{ platform: 'taobao', username: '示例淘天商城:客服甲' }]);
  const result = importAccounts(service, {
    format: 'shima-promotion-accounts', version: 1,
    accounts: [
      { platform: 'taobao', username: '示例淘天商城:客服甲', password: 'test-taobao-pass', name: '示例淘天商城' },
      { platform: 'jd', username: '示例京东甲店-客服甲', password: 'test-jd-pass', name: '示例京东甲店' }
    ]
  });
  assert.deepEqual(result, { added: 1, skipped: 1 });
  assert.equal(service.data.shops.length, 2);
  const added = service.data.shops[1];
  assert.equal(added.name, '示例京东甲店');
  assert.equal(added.username, '示例京东甲店-客服甲');
  assert.equal(Buffer.from(added.secret, 'base64').toString(), 'sealed:test-jd-pass');
  assert.ok(service.calls.some(([kind, value]) => kind === 'encrypt' && value === 'test-jd-pass'));
});

test('未带店铺名的账号（JSON 导入）仍以账号作为展示名', () => {
  const service = fakeService();
  importAccounts(service, { format: 'shima-promotion-accounts', version: 1, accounts: [{ platform: 'jd', username: 'synthetic-jd', password: 'p' }] });
  assert.equal(service.data.shops[0].name, 'synthetic-jd');
});

test('账号导入通道按扩展名分流：Excel 走表格解析并回报明细', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shima-excel-'));
  const file = path.join(directory, '账号.xls');
  fs.writeFileSync(file, XLSX.write(book([
    ['平台', '账号', '密码'],
    ['淘天', '示例淘天商城:客服甲', 'test-taobao-pass'],
    ['拼多多', '某店:某客服', 'x123'],
    ['京东', '示例京东甲店-客服甲', 'test-jd-pass']
  ]), { type: 'buffer', bookType: 'biff8' }));
  const service = fakeService();
  let seenOptions;
  const dialog = { showOpenDialog: async (parent, options) => { seenOptions = options; return { filePaths: [file] }; } };
  try {
    const result = await transferAccounts({ service, action: 'importAccounts', dialog, parent: null, downloads: directory });
    assert.equal(result.source, 'excel');
    assert.equal(result.added, 2);
    assert.equal(result.skipped, 0);
    assert.equal(result.totalRows, 3);
    assert.deepEqual(result.invalid, [{ row: 3, reason: '平台「拼多多」暂不支持' }]);
    assert.deepEqual(seenOptions.filters[0].extensions, ['xlsx', 'xls', 'csv'], '文件选择必须把 Excel 放在首选项');
    assert.deepEqual(service.data.shops.map(s => s.name), ['示例淘天商城', '示例京东甲店']);
    assert.equal(service.accountTransferBusy, false, '导入结束后必须释放互斥标记');

    const again = await transferAccounts({ service, action: 'importAccounts', dialog, parent: null, downloads: directory });
    assert.deepEqual([again.added, again.skipped], [0, 2], '重复导入同一张表不应产生新账号');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('表格里没有可用账号时不写入任何记录', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shima-excel-'));
  const file = path.join(directory, '空账号.xlsx');
  fs.writeFileSync(file, XLSX.write(book([['平台', '账号', '密码'], ['拼多多', '某店:某客服', 'x123']]), { type: 'buffer', bookType: 'xlsx' }));
  const service = fakeService();
  const dialog = { showOpenDialog: async () => ({ filePaths: [file] }) };
  try {
    await assert.rejects(transferAccounts({ service, action: 'importAccounts', dialog, parent: null, downloads: directory }), /表格里没有可导入的账号（第 2 行：平台「拼多多」暂不支持）/);
    assert.equal(service.data.shops.length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
