/**
 * kawangmuse 主入口（BSC 尾数识别版）
 * 只做链上只读核验，不需要钱包私钥
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const apiRoutes = require('./routes/api');
const orderService = require('./services/orderService');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders(res, filePath) {
    // HTML 永不缓存，确保用户拿到最新页面
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.use('/api', apiRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    chain: 'BSC',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: '接口不存在' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

async function start() {
  const required = [
    'MONGODB_URI',
    'WALLET_ADDRESS',
    'BSC_RPC_URL',
    'USDT_CONTRACT_ADDRESS',
    'PRODSELLER_API_KEY'
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('缺少必要环境变量：' + missing.join(', '));
    console.error('请复制 .env.example 为 .env 并填写，可运行 npm run check 检查');
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.WALLET_ADDRESS)) {
    console.error('WALLET_ADDRESS 格式不正确');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB 已连接');

  orderService.startSweeper();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`服务已启动，端口 ${PORT}（BSC 尾数识别版）`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

start().catch((e) => {
  console.error('启动失败：', e.message);
  process.exit(1);
});

module.exports = app;
