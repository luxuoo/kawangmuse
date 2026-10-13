/**
 * 配置检查脚本：验证必要的环境变量是否正确
 */
require('dotenv').config();

const checks = [
  { key: 'MONGODB_URI', test: (v) => !!v, hint: '如 mongodb://localhost:27017/kawangmuse' },
  { key: 'WALLET_ADDRESS', test: (v) => /^0x[0-9a-fA-F]{40}$/.test(v || ''), hint: 'BSC 收款地址，0x 开头 40 位十六进制' },
  { key: 'BSC_RPC_URL', test: (v) => /^https?:\/\//.test(v || ''), hint: '如 https://bsc-dataseed.binance.org' },
  { key: 'USDT_CONTRACT_ADDRESS', test: (v) => /^0x[0-9a-fA-F]{40}$/.test(v || ''), hint: 'BSC USDT: 0x55d398326f99059ff775485246999027b3197955' },
  { key: 'PRODSELLER_API_KEY', test: (v) => !!v && v.length > 10, hint: 'ProdSeller 后台获取的 API Key', mask: true },
  { key: 'MARKUP_RATE', test: (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0; }, hint: '如 0.3 表示 30%', optional: true },
];

console.log('\n====================================');
console.log('环境变量配置检查');
console.log('====================================\n');

let failed = false;
for (const c of checks) {
  const v = process.env[c.key];
  const ok = c.test(v);
  if (!ok && !c.optional) failed = true;
  const shown = c.mask && v ? v.slice(0, 6) + '...' : v || '(未设置)';
  console.log(`${ok ? '✓' : '✗'} ${c.key}: ${shown}${!ok ? `  ← ${c.hint}` : ''}`);
}

console.log(failed ? '\n配置不完整，请按提示填写 .env\n' : '\n配置 OK，可以启动：npm start\n');
process.exit(failed ? 1 : 0);
