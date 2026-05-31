const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { 
  initDatabase, 
  getAddressInfo, 
  saveAddress, 
  saveTransactions, 
  getTransactions,
  getTransactionsPaginated,
  countTransactions,
  getTransactionStats
} = require('./database');
const { getTransactionsForAddress, getBlockNumber } = require('./ethService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/transactions/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const forceRefresh = req.query.refresh === 'true';

    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const normalizedAddress = address.toLowerCase();
    
    let cachedTransactions = [];
    let addressInfo = null;
    
    if (!forceRefresh) {
      addressInfo = await getAddressInfo(normalizedAddress);
      cachedTransactions = await getTransactions(normalizedAddress, limit);
      
      if (cachedTransactions.length >= limit) {
        return res.json({
          transactions: cachedTransactions,
          fromCache: true,
          count: cachedTransactions.length
        });
      }
    }

    const currentBlock = Number(await getBlockNumber());
    const startBlock = addressInfo ? addressInfo.last_block_number + 1 : 0;
    
    const newTransactions = await getTransactionsForAddress(
      normalizedAddress, 
      startBlock, 
      currentBlock,
      limit - cachedTransactions.length
    );

    if (newTransactions.length > 0) {
      await saveTransactions(normalizedAddress, newTransactions);
      await saveAddress(normalizedAddress, currentBlock);
    }

    const allTransactions = await getTransactions(normalizedAddress, limit);

    res.json({
      transactions: allTransactions,
      fromCache: false,
      count: allTransactions.length,
      newFetched: newTransactions.length
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions/:address/paginated', async (req, res) => {
  try {
    const { address } = req.params;
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);

    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const normalizedAddress = address.toLowerCase();
    
    const [transactions, total] = await Promise.all([
      getTransactionsPaginated(normalizedAddress, page, pageSize),
      countTransactions(normalizedAddress)
    ]);

    res.json({
      transactions,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      fromCache: true
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions/:address/stats', async (req, res) => {
  try {
    const { address } = req.params;

    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return res.status(400).json({ error: 'Invalid Ethereum address' });
    }

    const normalizedAddress = address.toLowerCase();
    const stats = await getTransactionStats(normalizedAddress);

    res.json({
      address: normalizedAddress,
      stats
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`Ethereum Transaction Tracker Backend`);
    console.log(`Server running on port ${PORT}`);
    console.log(`RPC URL: ${process.env.RPC_URL}`);
  });
}

startServer();
