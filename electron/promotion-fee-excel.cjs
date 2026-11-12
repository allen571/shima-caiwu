'use strict';
// 推广费账号表格解析：把 .xlsx / .xls / .csv 表格转换成规范账号候选列表。
// 本模块只做「表格 → 数据」的纯转换：不写盘、不加密、不接触会话与网络，方便单测。
const XLSX = require('../vendor/xlsx.full.min.js');

// 平台列取值 → 内部平台代号。
// 淘天是淘宝+天猫的统称，两者在程序内可信域与查询入口完全一致，统一按淘宝保存。
const PLATFORM_ALIASES = new Map([
  ['淘宝', 'taobao'], ['淘宝网', 'taobao'], ['淘天', 'taobao'], ['阿里', 'taobao'],
  ['阿里妈妈', 'taobao'], ['万相台', 'taobao'], ['c店', 'taobao'], ['taobao', 'taobao'],
  ['天猫', 'tmall'], ['天猫商城', 'tmall'], ['tmall', 'tmall'],
  ['京东', 'jd'], ['京东商城', 'jd'], ['京准通', 'jd'], ['京东pop', 'jd'], ['jd', 'jd'],
  ['抖音', 'douyin'], ['抖店', 'douyin'], ['抖音小店', 'douyin'],
  ['抖音电商', 'douyin'], ['douyin', 'douyin']
]);

// 表头字段别名。财务侧一个店铺对应一个账号，账号列只认单值列，
// 不识别客服排班表里的「早班/晚班」双列结构——那是另一个部门的台账，账号不通用。
const HEADER_FIELDS = [
  ['platform', ['平台', '站点', '店铺平台', '所属平台', '平台名称', '电商平台', '平台类别']],
  ['password', ['密码', '登录密码', '账号密码', '登陆密码', '口令', 'password', 'pwd']],
  ['shopName', ['店铺', '店铺名', '店铺名称', '店名', '店铺全称', '店铺简称', 'shop', 'shopname']],
  ['username', ['账号', '登录账号', '帐号', '用户名', '店铺账号', '账号名', '登录名', '主账号']]
];

// 单个账号字段上限，与 promotion-fee.cjs 的 putShop 校验保持一致
const LIMITS = { username: 120, name: 120, password: 4096 };
// 表头行最多向下找 10 行，超出视为表格结构无法识别
const HEADER_SCAN_ROWS = 10;

// 表头/取值归一化：去掉空白与常见修饰符，全角转半角，统一小写后比对
function normalize(value) {
  return String(value ?? '')
    .replace(/[\u3000\s]/g, '')
    .replace(/[（）()【】\[\]*＊:：]/g, '')
    .toLowerCase();
}

// 单元格转文本：数字走 BigInt 精确转换，避免 1.379983029e+10 这种科学计数法
function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER) return BigInt(value).toString();
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

// 登录账号原文清洗：去掉零宽字符、压缩空白、全角冒号归一为半角。
// 淘系子账号写作「店铺:子账号」，全角冒号粘进登录框会被平台判为错误账号。
function cleanAccount(value) {
  return toText(value)
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[\u3000\s]+/g, ' ')
    .replace(/\uFF1A/g, ':')
    .trim();
}

// 在一行表头里定位各字段所在列号；找不到的字段不出现在结果中
function mapHeader(row) {
  const index = {};
  const cells = row.map(normalize);
  for (const [field, aliases] of HEADER_FIELDS) {
    const wanted = new Set(aliases.map(normalize));
    const at = cells.findIndex(cell => cell && wanted.has(cell));
    if (at >= 0 && index[field] === undefined) index[field] = at;
  }
  return index;
}

// 在前若干行里找表头：必须同时认出「密码」和账号列
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i += 1) {
    const index = mapHeader(rows[i] || []);
    if (index.password !== undefined && index.username !== undefined) return { row: i, index };
  }
  return null;
}

// 从登录账号拆出店铺展示名：优先「店铺:账号」，其次「店铺-账号」，拆不出就用原值
function splitShopName(account, fallback) {
  if (fallback) return fallback.slice(0, LIMITS.name);
  const matched = account.match(/^(.+?)(?:\s*[:：]\s*|\s*[-－—]\s*)([^:：\-－—]+)$/);
  const name = matched ? matched[1].trim() : account;
  return (name || account).slice(0, LIMITS.name);
}

// 解析工作簿里的某一页；sheet 为空表示取第一页
function readSheet(workbook, sheet) {
  const names = workbook.SheetNames || [];
  if (!names.length) throw Error('表格里没有工作表');
  const sheetName = sheet && names.includes(sheet) ? sheet : names[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1, defval: '', raw: true, blankrows: true
  });
  return { sheetName, rows };
}

// 主入口：返回 { accounts, invalid, emptyRows, totalRows, sheet, columns, notes }
// accounts 已按「平台+账号」内部去重；外部已有账号的去重由调用方负责
function parseAccountWorkbook(workbook, { sheet } = {}) {
  const { sheetName, rows } = readSheet(workbook, sheet);
  const header = findHeader(rows);
  if (!header) {
    throw Error('未识别到表头：表格需包含「平台」「账号」「密码」三列');
  }
  const { row: headerRow, index } = header;
  if (index.platform === undefined) throw Error('未找到平台列：请在表头写明「平台」');
  if (index.username === undefined) throw Error('未找到账号列：请在表头写明「账号」');

  // 财务一店一账号，账号列即唯一来源
  const accountColumn = index.username;
  const notes = [];

  const accounts = [];
  const invalid = [];
  const seen = new Set();
  let emptyRows = 0;
  let lastPlatform = '';
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const account = cleanAccount(row[accountColumn]);
    const password = toText(row[index.password]).replace(/[\u200b-\u200d\ufeff]/g, '');
    const rawPlatform = normalize(row[index.platform]);
    // 淘宝/天猫等按平台分块的表常把平台列合并单元格，空白行沿用上一行平台
    if (rawPlatform) lastPlatform = rawPlatform;
    const platform = PLATFORM_ALIASES.get(rawPlatform || lastPlatform) || '';
    const lineNumber = r + 1;
    if (!account && !password) { emptyRows += 1; continue; }
    if (!account) { invalid.push({ row: lineNumber, reason: '账号为空' }); continue; }
    if (!password) { invalid.push({ row: lineNumber, reason: '密码为空' }); continue; }
    if (!platform) {
      const shown = toText(row[index.platform]).trim() || '(空)';
      invalid.push({ row: lineNumber, reason: '平台「' + shown.slice(0, 20) + '」暂不支持' });
      continue;
    }
    if (account.length > LIMITS.username) { invalid.push({ row: lineNumber, reason: '账号超过 120 字符' }); continue; }
    if (password.length > LIMITS.password) { invalid.push({ row: lineNumber, reason: '密码超过 4096 字符' }); continue; }
    const key = JSON.stringify([platform, account]);
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({
      platform,
      username: account,
      password,
      name: splitShopName(account, index.shopName === undefined ? '' : cleanAccount(row[index.shopName]))
    });
  }
  return {
    accounts,
    invalid,
    emptyRows,
    totalRows: Math.max(0, rows.length - headerRow - 1),
    sheet: sheetName,
    columns: index,
    notes
  };
}

// 从文件内容解析：按扩展名区分文本型 CSV 与二进制工作簿
function parseAccountsFromFile(buffer, fileName) {
  if (!buffer || !buffer.length) throw Error('表格文件为空');
  const extension = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  let workbook;
  if (extension === 'csv' || extension === 'txt') {
    let text = buffer.toString('utf8');
    // UTF-8 解出替换字符说明原文件是 GBK/GB18030（WPS 导出常见），改用 GBK 再解一次
    if (text.includes('\ufffd')) {
      try { text = new TextDecoder('gbk').decode(buffer); } catch { /* 运行环境无 GBK 时保持 UTF-8 结果 */ }
    }
    workbook = XLSX.read(text.replace(/^\ufeff/, ''), { type: 'string', raw: false });
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  }
  return parseAccountWorkbook(workbook);
}

module.exports = {
  parseAccountWorkbook,
  parseAccountsFromFile,
  PLATFORM_ALIASES,
  normalize,
  splitShopName,
  cleanAccount
};
