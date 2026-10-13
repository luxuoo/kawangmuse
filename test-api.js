/**
 * API 冒烟测试（只读接口 + 校验逻辑，不产生真实订单）
 */
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0;
let fail = 0;

function ok(name, detail) {
  pass++;
  console.log(`✓ ${name}` + (detail ? `：${detail}` : ''));
}
function bad(name, detail) {
  fail++;
  console.log(`✗ ${name}：${detail}`);
}

(async () => {
  console.log('\n=== 健康检查 ===');
  try {
    const r = await axios.get(`${BASE_URL}/health`);
    r.data.status === 'ok' ? ok('健康检查', `chain=${r.data.chain}`) : bad('健康检查', JSON.stringify(r.data));
  } catch (e) { bad('健康检查', e.message); }

  console.log('\n=== 收款配置 ===');
  try {
    const r = await axios.get(`${BASE_URL}/api/payinfo`);
    r.data.success ? ok('收款配置', r.data.data.walletAddress) : bad('收款配置', r.data.error);
  } catch (e) { bad('收款配置', e.message); }

  console.log('\n=== 商品列表 ===');
  let products = [];
  try {
    const r = await axios.get(`${BASE_URL}/api/products`);
    products = r.data.data || [];
    r.data.success ? ok('商品列表', `共 ${products.length} 个`) : bad('商品列表', r.data.error);
  } catch (e) { bad('商品列表', e.message); }

  console.log('\n=== 余额 ===');
  try {
    const r = await axios.get(`${BASE_URL}/api/balance`);
    r.data.success ? ok('余额查询', JSON.stringify(r.data.data).slice(0, 120)) : bad('余额查询', r.data.error);
  } catch (e) { bad('余额查询', e.message); }

  console.log('\n=== 非法交易哈希应被拒绝（400）===');
  try {
    await axios.post(`${BASE_URL}/api/orders/000000000000000000000000`, { txHash: 'not-a-hash' });
    bad('非法哈希校验', '竟然通过了');
  } catch (e) {
    e.response && e.response.status === 400 ? ok('非法哈希被拒绝') : bad('非法哈希校验', e.message);
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})();
