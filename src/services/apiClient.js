/**
 * ProdSeller API 客户端
 * 文档：https://prodseller.com/api-docs/
 */

const axios = require('axios');

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: 'https://prodseller.com/v1',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.PRODSELLER_API_KEY
      }
    });
  }

  /** 余额 */
  async getBalance() {
    const res = await this.client.get('/balance');
    return res.data;
  }

  /** 商品列表 */
  async getProducts() {
    const res = await this.client.get('/products');
    const data = res.data;
    // 兼容 { products: [...] } 与 [...] 两种形状
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.products)) return data.products;
    return [];
  }

  /**
   * 创建供应商订单（带幂等键，重试不会重复扣款）
   * @param {string} productId
   * @param {number} quantity
   * @param {string} idempotencyKey 建议使用本地订单 ID
   * @param {string|string[]} [email] 邮箱激活类商品需要
   */
  async createOrder(productId, quantity, idempotencyKey, email) {
    const payload = { productId, quantity };
    if (email) payload.email = email;
    const res = await this.client.post('/orders', payload, {
      headers: { 'Idempotency-Key': idempotencyKey }
    });
    return res.data;
  }

  /** 查询供应商订单（用于轮询发货状态） */
  async getOrder(orderId) {
    const res = await this.client.get(`/orders/${orderId}`);
    return res.data;
  }
}

module.exports = new ApiClient();
