/**
 * 订单数据模型（BSC 尾数识别版）
 *
 * 流程：pending(待支付) → verifying(验证中) → paid(已支付)
 *      → purchasing(采购中) → delivered(已发货) / failed(失败)
 *      pending 超时 → expired(已过期)
 */

const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    productName: { type: String },
    quantity: { type: Number, required: true, min: 1 },

    // 计价：单价保留 2 位小数 + 1~999 微单位识别码
    unitPrice: { type: Number, required: true },
    suffixMicros: { type: Number, required: true, min: 1, max: 999 },
    // 应付精确金额，6 位小数字符串，如 "0.780393"
    expectedAmount: { type: String, required: true },
    walletAddress: { type: String, required: true, lowercase: true },

    status: {
      type: String,
      enum: ['pending', 'verifying', 'paid', 'purchasing', 'delivered', 'failed', 'expired'],
      default: 'pending',
      index: true
    },

    // 用户提交的 BSC 交易哈希（全局唯一，防止重复使用）
    txHash: { type: String, sparse: true, unique: true, lowercase: true },
    confirmations: { type: Number },

    // 供应商订单
    apiOrderId: { type: String },
    deliveredKeys: [{ type: String }],

    errorMessage: { type: String },

    expiresAt: { type: Date, required: true, index: true },
    paidAt: { type: Date },
    deliveredAt: { type: Date }
  },
  { timestamps: true }
);

orderSchema.index({ status: 1, expiresAt: 1 });
orderSchema.index({ expectedAmount: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);
