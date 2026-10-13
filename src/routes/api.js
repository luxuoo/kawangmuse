/**
 * API 路由（BSC 尾数识别版）
 */

const express = require('express');
const router = express.Router();
const apiClient = require('../services/apiClient');
const orderService = require('../services/orderService');
const Order = require('../models/order');

function sendError(res, e) {
  const code = e.statusCode || 500;
  res.status(code).json({ success: false, error: e.message || '服务器内部错误' });
}

/** 商品列表（含加价后售价） */
router.get('/products', async (req, res) => {
  try {
    const products = await apiClient.getProducts();
    res.json({
      success: true,
      data: (products || []).map((p) => ({
        id: String(p.id),
        name: p.name,
        price: Number(p.price),
        salePrice: orderService.salePriceOf(p),
        inStock: p.inStock !== false,
        requiresEmail: !!p.requiresEmailActivation
      }))
    });
  } catch (e) {
    sendError(res, e);
  }
});

/** 供应平台余额 */
router.get('/balance', async (req, res) => {
  try {
    const data = await apiClient.getBalance();
    res.json({ success: true, data });
  } catch (e) {
    sendError(res, e);
  }
});

/** 收款配置（给前端展示用） */
router.get('/payinfo', (req, res) => {
  res.json({
    success: true,
    data: {
      walletAddress: process.env.WALLET_ADDRESS,
      chain: 'BSC',
      token: 'USDT',
      requiredConfirmations: parseInt(process.env.REQUIRED_CONFIRMATIONS || '15', 10),
      expireMinutes: parseInt(process.env.ORDER_EXPIRE_MINUTES || '30', 10)
    }
  });
});

/** 创建订单 */
router.post('/orders', async (req, res) => {
  try {
    const { productId, quantity, email } = req.body || {};
    if (!productId) return res.status(400).json({ success: false, error: '缺少商品 ID' });
    const order = await orderService.createOrder(productId, quantity, email);
    res.json({ success: true, data: orderService.publicView(order) });
  } catch (e) {
    sendError(res, e);
  }
});

/** 查询订单 */
router.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: '订单不存在' });
    res.json({ success: true, data: orderService.publicView(order) });
  } catch (e) {
    sendError(res, e);
  }
});

/** 提交交易哈希并核验 */
router.post('/orders/:id/verify', async (req, res) => {
  try {
    const { txHash } = req.body || {};
    if (!txHash) return res.status(400).json({ success: false, error: '缺少交易哈希' });
    const order = await orderService.submitTx(req.params.id, txHash);
    res.json({ success: true, data: orderService.publicView(order) });
  } catch (e) {
    const code = e.statusCode || 400;
    res.status(code).json({
      success: false,
      error: e.message,
      retryable: !!e.retryable,
      confirmations: e.confirmations
    });
  }
});

/** 系统状态 */
router.get('/status', async (req, res) => {
  try {
    const [pending, purchasing, delivered, failed] = await Promise.all([
      Order.countDocuments({ status: { $in: ['pending', 'verifying'] } }),
      Order.countDocuments({ status: { $in: ['paid', 'purchasing'] } }),
      Order.countDocuments({ status: 'delivered' }),
      Order.countDocuments({ status: 'failed' })
    ]);
    res.json({ success: true, data: { pending, purchasing, delivered, failed } });
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;
