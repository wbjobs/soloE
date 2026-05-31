const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'transactions.db');
const db = new sqlite3.Database(dbPath);

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS addresses (
        address TEXT PRIMARY KEY,
        last_queried INTEGER,
        last_block_number INTEGER
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS transactions (
        hash TEXT PRIMARY KEY,
        address TEXT,
        block_number INTEGER,
        timestamp INTEGER,
        from_address TEXT,
        to_address TEXT,
        value TEXT,
        gas_price TEXT,
        gas_used INTEGER,
        is_contract_interaction INTEGER,
        input TEXT,
        FOREIGN KEY (address) REFERENCES addresses(address)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_address ON transactions(address)`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_block ON transactions(block_number)`);
      
      resolve();
    });
  });
}

function saveAddress(address, lastBlockNumber) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`INSERT OR REPLACE INTO addresses (address, last_queried, last_block_number)
      VALUES (?, ?, ?)`);
    stmt.run(address, Date.now(), lastBlockNumber, function(err) {
      if (err) reject(err);
      else resolve();
    });
    stmt.finalize();
  });
}

function getAddressInfo(address) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM addresses WHERE address = ?`, [address], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function saveTransactions(address, transactions) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_nft INTEGER DEFAULT 0`);
      db.run(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS nft_standard TEXT`);

      const stmt = db.prepare(`INSERT OR IGNORE INTO transactions 
        (hash, address, block_number, timestamp, from_address, to_address, value, gas_price, gas_used, is_contract_interaction, is_nft, nft_standard, input)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      transactions.forEach(tx => {
        stmt.run(
          tx.hash,
          address,
          tx.blockNumber,
          tx.timestamp,
          tx.from,
          tx.to,
          tx.value,
          tx.gasPrice,
          tx.gasUsed,
          tx.isContractInteraction ? 1 : 0,
          tx.isNFT ? 1 : 0,
          tx.nftStandard,
          tx.input
        );
      });

      stmt.finalize((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function getTransactions(address, limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM transactions WHERE address = ? ORDER BY block_number DESC LIMIT ?`, 
      [address, limit], 
      (err, rows) => {
        if (err) reject(err);
        else {
          resolve(rows.map(row => ({
            hash: row.hash,
            blockNumber: row.block_number,
            timestamp: row.timestamp,
            from: row.from_address,
            to: row.to_address,
            value: row.value,
            gasPrice: row.gas_price,
            gasUsed: row.gas_used,
            isContractInteraction: row.is_contract_interaction === 1,
            isNFT: row.is_nft === 1,
            nftStandard: row.nft_standard,
            input: row.input
          })));
        }
      });
  });
}

function getTransactionsPaginated(address, page = 1, pageSize = 20) {
  return new Promise((resolve, reject) => {
    const offset = (page - 1) * pageSize;
    db.all(`SELECT * FROM transactions WHERE address = ? ORDER BY block_number DESC LIMIT ? OFFSET ?`, 
      [address, pageSize, offset], 
      (err, rows) => {
        if (err) reject(err);
        else {
          resolve(rows.map(row => ({
            hash: row.hash,
            blockNumber: row.block_number,
            timestamp: row.timestamp,
            from: row.from_address,
            to: row.to_address,
            value: row.value,
            gasPrice: row.gas_price,
            gasUsed: row.gas_used,
            isContractInteraction: row.is_contract_interaction === 1,
            isNFT: row.is_nft === 1,
            nftStandard: row.nft_standard,
            input: row.input
          })));
        }
      });
  });
}

function countTransactions(address) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) as count FROM transactions WHERE address = ?`, 
      [address], 
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.count : 0);
      });
  });
}

function getTransactionStats(address) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT 
        from_address as address, 
        COUNT(*) as count, 
        SUM(CAST(value as REAL)) as totalValue,
        'out' as type
      FROM transactions 
      WHERE address = ? AND from_address != ?
      GROUP BY from_address
      UNION ALL
      SELECT 
        to_address as address, 
        COUNT(*) as count, 
        SUM(CAST(value as REAL)) as totalValue,
        'in' as type
      FROM transactions 
      WHERE address = ? AND to_address != ?
      GROUP BY to_address`, 
      [address, address, address, address], 
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
  });
}

module.exports = {
  initDatabase,
  saveAddress,
  getAddressInfo,
  saveTransactions,
  getTransactions,
  getTransactionsPaginated,
  countTransactions,
  getTransactionStats
};
