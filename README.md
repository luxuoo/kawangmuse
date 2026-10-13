# kawangmuse · BSC 自动发货系统（v2.0）

用户在 BSC 链上用 USDT 付款，系统按**尾数金额**识别订单：用户提交交易哈希后，服务端做链上只读核验，通过即自动从 ProdSeller 采购发货。

**v2.0 相对旧版的变化**：只支持 BSC；只核验收款地址收到的转账；用户主动提交交易哈希（不再需要常驻监听）；**服务端不再需要钱包私钥**；下单带幂等键；邮箱激活类商品会轮询到发货为止。

## 付款流程

```
1. 用户选商品 → 服务端生成订单，返回精确应付金额
   （商品售价保留 2 位小数 + 0.000001~0.000999 唯一识别码）
   例：售价 0.78 → 实付 0.780393
2. 用户用 BSC 网络转精确金额的 USDT 到收款地址
3. 用户提交交易哈希 → 服务端核验：
   - 交易存在且执行成功
   - 包含一笔 USDT Transfer：收款方 = 本店地址、金额精确相等
   - 确认数 ≥ 15（可配）
   - 交易时间在订单有效期内
   - 哈希未被其他订单用过
4. 核验通过 → 带 Idempotency-Key 向 ProdSeller 下单（重试不重复扣款）
5. 邮箱激活类商品轮询至 delivered，卡密写入订单
```

## 快速开始

```bash
npm install
cp .env.example .env
# 填写 .env（注意：不需要钱包私钥）
npm run check   # 检查配置
npm start
```

打开 http://localhost:3000 即可看到下单页面。

## 环境变量

| 变量 | 说明 |
|---|---|
| `WALLET_ADDRESS` | BSC 收款地址（公钥即可） |
| `BSC_RPC_URL` | BSC 公共 RPC，默认 `https://bsc-dataseed.binance.org` |
| `USDT_CONTRACT_ADDRESS` | BSC USDT：`0x55d398326f99059f775485246999027b3197955` |
| `PRODSELLER_API_KEY` | ProdSeller API Key |
| `MARKUP_RATE` | 加价率，`0.3` = 30% |
| `ORDER_EXPIRE_MINUTES` | 订单有效期（分钟），默认 30 |
| `REQUIRED_CONFIRMATIONS` | 确认数要求，默认 15 |
| `MONGODB_URI` | MongoDB 连接串 |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/api/payinfo` | 收款地址/链/确认数配置 |
| GET | `/api/products` | 商品列表（含加价后售价） |
| GET | `/api/balance` | ProdSeller 余额 |
| POST | `/api/orders` | 创建订单 `{productId, quantity}` |
| GET | `/api/orders/:id` | 订单状态（含发货卡密） |
| POST | `/api/orders/:id/verify` | 提交 `{txHash}` 核验付款 |
| GET | `/api/status` | 各状态订单计数 |

订单状态：`pending` 待支付 → `verifying` 验证中 → `paid` 已支付 → `purchasing` 采购中 → `delivered` 已发货 / `failed` 失败；超时未付 → `expired`。

## 安全建议

- `.env` 绝不提交到 Git（已在 `.gitignore`）
- 正式收款前在 ProdSeller 后台轮换 API Key
- 如需把管理接口暴露到公网，建议自行加鉴权/限流后再上线
