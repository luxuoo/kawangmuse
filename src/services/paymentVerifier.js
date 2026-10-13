/**
 * BSC 链上付款核验（只读，不需要钱包私钥）
 *
 * 核验用户提交的交易哈希：
 *  1. 交易存在且执行成功
 *  2. 包含一笔 USDT Transfer：收款方 = 本店钱包，金额 = 订单应付金额（精确到 6 位小数）
 *  3. 确认数达到要求
 *  4. 交易时间落在订单有效期内
 */

const { ethers } = require('ethers');

// Transfer(address,address,uint256)
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

class PaymentVerifier {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
    this.usdt = (process.env.USDT_CONTRACT_ADDRESS || '').toLowerCase();
    this.requiredConfirmations = parseInt(process.env.REQUIRED_CONFIRMATIONS || '15', 10);
  }

  /**
   * 从回执中找出匹配的 USDT 转账（纯函数，便于测试）
   * @param {object} receipt 交易回执
   * @param {string} walletAddress 收款地址
   * @param {bigint} expectedWei 应付金额（wei，USDT 18 位小数）
   * @returns {boolean}
   */
  findMatchingTransfer(receipt, walletAddress, expectedWei) {
    if (!receipt || !Array.isArray(receipt.logs)) return false;
    const wallet = walletAddress.toLowerCase();
    for (const log of receipt.logs) {
      if (!log.address || log.address.toLowerCase() !== this.usdt) continue;
      if (!log.topics || !log.topics[0] || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
      if (!log.topics[2]) continue;
      const to = '0x' + log.topics[2].slice(-40).toLowerCase();
      if (to !== wallet) continue;
      let value;
      try {
        value = BigInt(log.data);
      } catch {
        continue;
      }
      if (value === expectedWei) return true;
    }
    return false;
  }

  /**
   * 核验交易哈希
   * @returns {Promise<{ok:boolean, reason?:string, confirmations?:number, retryable?:boolean}>}
   */
  async verify(txHash, { walletAddress, expectedAmount, createdAt, expiresAt }) {
    let receipt;
    try {
      receipt = await this.provider.getTransactionReceipt(txHash);
    } catch (e) {
      return { ok: false, reason: '链上查询失败，请稍后重试：' + e.message };
    }
    if (!receipt) {
      return { ok: false, reason: '未找到该交易，请确认哈希无误且交易已上链', retryable: true };
    }
    if (Number(receipt.status) !== 1) {
      return { ok: false, reason: '该交易在链上执行失败' };
    }

    let expectedWei;
    try {
      expectedWei = ethers.parseUnits(expectedAmount, 18); // expectedAmount 为 6 位小数字符串
    } catch {
      return { ok: false, reason: '订单金额异常，请联系客服' };
    }

    if (!this.findMatchingTransfer(receipt, walletAddress, expectedWei)) {
      return {
        ok: false,
        reason: `未在该交易中找到向 ${walletAddress} 的 ${expectedAmount} USDT 转账，请确认金额精确一致（含尾数）`
      };
    }

    const currentBlock = await this.provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber;
    if (confirmations < this.requiredConfirmations) {
      return {
        ok: false,
        retryable: true,
        confirmations,
        reason: `确认数不足（当前 ${confirmations}/${this.requiredConfirmations}），请等待区块确认后重新点击验证`
      };
    }

    const block = await this.provider.getBlock(receipt.blockNumber);
    const txTime = block.timestamp * 1000;
    if (txTime < createdAt.getTime() - 60000) {
      return { ok: false, reason: '该交易时间早于订单创建时间' };
    }
    if (txTime > expiresAt.getTime()) {
      return { ok: false, reason: '该交易已超过订单有效期' };
    }

    return { ok: true, confirmations };
  }
}

module.exports = new PaymentVerifier();
