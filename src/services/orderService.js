/**
 * 订单服务：创建尾数订单 → 用户提交交易哈希 → 链上核验 → 供应商采购 → 发货
 */

const Order = require('../models/order');
const apiClient = require('./apiClient');
const paymentVerifier = require('./paymentVerifier');

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ACTIVE_STATUSES = ['pending', 'verifying'];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function getMarkup() {
  const m = parseFloat(process.env.MARKUP_RATE || '0.3');
  return Number.isFinite(m) && m >= 0 ? m : 0.3;
}

function getExpireMinutes() {
  const v = parseInt(process.env.ORDER_EXPIRE_MINUTES || '30', 10);
  return Number.isFinite(v) && v > 0 ? v : 30;
}

/** 商品售价（含加价，2 位小数） */
function salePriceOf(product) {
  return round2(Number(product.price) * (1 + getMarkup()));
}

/**
 * 创建订单：生成待支付订单与唯一尾数金额
 */
async function createOrder(productId, quantity, email) {
  quantity = parseInt(quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new Error('购买数量不合法（1~100）');
  }

  const products = await apiClient.getProducts();
  const product = (products || []).find((p) => String(p.id) === String(productId));
  if (!product) throw new Error('商品不存在或已下架');

  const cost = Number(product.price);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('商品价格异常');

  const unitPrice = salePriceOf(product);
  const baseTotal = round2(unitPrice * quantity);

  // 生成唯一尾数：1~999 微单位，待支付订单中应付金额唯一
  let suffixMicros = 0;
  let expectedAmount = '';
  for (let i = 0; i < 30; i++) {
    suffixMicros = 1 + Math.floor(Math.random() * 999);
    expectedAmount = (baseTotal + suffixMicros / 1e6).toFixed(6);
    const dup = await Order.findOne({ status: { $in: ACTIVE_STATUSES }, expectedAmount });
    if (!dup) break;
    if (i === 29) throw new Error('识别码冲突，请稍后重试');
  }

  const order = new Order({
    productId: String(product.id),
    productName: product.name,
    quantity,
    unitPrice,
    suffixMicros,
    expectedAmount,
    walletAddress: process.env.WALLET_ADDRESS,
    status: 'pending',
    expiresAt: new Date(Date.now() + getExpireMinutes() * 60000)
  });
  await order.save();
  return order;
}

/** 订单公开视图（不暴露敏感字段） */
function publicView(order) {
  return {
    id: String(order._id),
    productId: order.productId,
    productName: order.productName,
    quantity: order.quantity,
    unitPrice: order.unitPrice,
    expectedAmount: order.expectedAmount,
    suffixMicros: order.suffixMicros,
    walletAddress: order.walletAddress,
    status: order.status,
    txHash: order.txHash || null,
    confirmations: order.confirmations || null,
    deliveredKeys: order.status === 'delivered' ? order.deliveredKeys : [],
    errorMessage: order.errorMessage || null,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    deliveredAt: order.deliveredAt || null
  };
}

/**
 * 用户提交交易哈希 → 链上核验 → 通过后转入采购
 */
async function submitTx(orderId, txHash) {
  const order = await Order.findById(orderId);
  if (!order) {
    const err = new Error('订单不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!TX_HASH_RE.test(txHash || '')) {
    const err = new Error('交易哈希格式不正确');
    err.statusCode = 400;
    throw err;
  }
  if (order.status === 'delivered') return order;
  if (order.status === 'expired') throw new Error('订单已过期，请重新下单');
  if (!['pending', 'verifying', 'failed'].includes(order.status)) {
    throw new Error(`订单当前状态（${order.status}）不可验证`);
  }
  if (order.expiresAt.getTime() < Date.now() && order.status === 'pending') {
    order.status = 'expired';
    await order.save();
    throw new Error('订单已过期，请重新下单');
  }

  const normalized = txHash.toLowerCase();
  const dup = await Order.findOne({ txHash: normalized });
  if (dup && String(dup._id) !== String(order._id)) {
    throw new Error('该交易哈希已被其他订单使用');
  }

  order.status = 'verifying';
  order.txHash = normalized;
  order.errorMessage = null;
  await order.save();

  const result = await paymentVerifier.verify(normalized, {
    walletAddress: order.walletAddress,
    expectedAmount: order.expectedAmount,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt
  });

  if (!result.ok) {
    // 可重试的失败回到 pending，允许换哈希/等待确认后重试
    order.status = result.retryable ? 'pending' : 'pending';
    order.errorMessage = result.reason;
    await order.save();
    const err = new Error(result.reason);
    err.statusCode = 400;
    err.retryable = !!result.retryable;
    err.confirmations = result.confirmations;
    throw err;
  }

  order.status = 'paid';
  order.confirmations = result.confirmations;
  order.paidAt = new Date();
  order.errorMessage = null;
  await order.save();

  // 后台采购，不阻塞验证响应（前端轮询订单状态）
  purchaseInBackground(order._id).catch((e) => {
    console.error(`[purchase] order ${order._id} failed:`, e.message);
  });

  return order;
}

/** 从供应商 API 响应中提取发货卡密 */
function extractKeys(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.deliveredKeys) && data.deliveredKeys.length) return data.deliveredKeys;
  if (data.deliveredKey) return [data.deliveredKey];
  if (Array.isArray(data.items) && data.items.length) {
    return data.items.map((it) =>
      typeof it === 'string' ? it : it.key || it.code || JSON.stringify(it)
    );
  }
  return [];
}

/** 轮询供应商订单直到发货（邮箱激活类商品） */
async function pollDelivered(apiOrderId, timeoutMs = 10 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await apiClient.getOrder(apiOrderId);
    const keys = extractKeys(data);
    const status = String(data.status || '').toLowerCase();
    if (status === 'delivered' || keys.length > 0) return keys;
    if (['failed', 'cancelled', 'canceled', 'refunded'].includes(status)) {
      throw new Error(`供应商订单异常：${status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('等待供应商发货超时，请联系客服手动处理');
}

/** 后台采购流程 */
async function purchaseInBackground(orderId) {
  const order = await Order.findById(orderId);
  if (!order || order.status !== 'paid') return;

  order.status = 'purchasing';
  await order.save();

  try {
    // 幂等键 = 本地订单 ID，重试不会重复扣款
    const data = await apiClient.createOrder(
      order.productId,
      order.quantity,
      `order-${order._id}`
    );
    order.apiOrderId = String(data.id || data.orderId || '');
    const keys = await pollDelivered(order.apiOrderId);
    order.deliveredKeys = keys;
    order.status = 'delivered';
    order.deliveredAt = new Date();
    order.errorMessage = null;
  } catch (e) {
    order.status = 'failed';
    order.errorMessage = e.message;
  }
  await order.save();
}

/** 过期清理：每分钟把超时的待支付订单标为过期并释放尾数 */
function startSweeper() {
  setInterval(async () => {
    try {
      await Order.updateMany(
        { status: 'pending', expiresAt: { $lt: new Date() } },
        { $set: { status: 'expired' } }
      );
    } catch (e) {
      console.error('[sweeper]', e.message);
    }
  }, 60000);
}

module.exports = {
  createOrder,
  submitTx,
  publicView,
  salePriceOf,
  getMarkup,
  startSweeper,
  purchaseInBackground
};
