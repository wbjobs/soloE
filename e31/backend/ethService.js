const { Web3 } = require('web3');
require('dotenv').config();

const web3 = new Web3(process.env.RPC_URL);

const ERC721_TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC1155_TRANSFER_SINGLE_SIG = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c08307b1f14ce75';
const ERC1155_TRANSFER_BATCH_SIG = '0x4a39dc06d40bd098d1f54c09a7a65e8e792f8a46b4c0e12f5d1';

function detectNFTTransaction(tx) {
  const input = tx.input || '0x';
  const methodSig = input.slice(0, 10);
  
  if (methodSig === ERC721_TRANSFER_SIG) {
    return { isNFT: true, nftStandard: 'ERC-721' };
  }
  
  if (methodSig === ERC1155_TRANSFER_SINGLE_SIG || methodSig === ERC1155_TRANSFER_BATCH_SIG) {
    return { isNFT: true, nftStandard: 'ERC-1155' };
  }
  
  return { isNFT: false, nftStandard: null };
}

async function getBlockNumber() {
  return await web3.eth.getBlockNumber();
}

async function getTransactionReceipt(txHash) {
  return await web3.eth.getTransactionReceipt(txHash);
}

async function getBlock(blockNumber, includeTransactions = true) {
  return await web3.eth.getBlock(blockNumber, includeTransactions);
}

async function isContract(address) {
  const code = await web3.eth.getCode(address);
  return code !== '0x';
}

async function getTransactionsForAddress(targetAddress, startBlock = 0, endBlock = null, limit = 100) {
  const transactions = [];
  const address = targetAddress.toLowerCase();
  
  if (!endBlock) {
    endBlock = Number(await getBlockNumber());
  }

  let currentBlock = endBlock;
  let foundCount = 0;

  while (currentBlock >= startBlock && foundCount < limit) {
    try {
      const block = await getBlock(currentBlock, true);
      
      if (!block || !block.transactions) {
        currentBlock--;
        continue;
      }

      for (const tx of block.transactions) {
        if (foundCount >= limit) break;

        const from = tx.from ? tx.from.toLowerCase() : null;
        const to = tx.to ? tx.to.toLowerCase() : '';

        if (from === address || to === address) {
          const receipt = await getTransactionReceipt(tx.hash);
          const isContractInteraction = await isContract(tx.to || '0x');
          const nftInfo = detectNFTTransaction(tx);
          
          transactions.push({
            hash: tx.hash,
            blockNumber: Number(tx.blockNumber),
            timestamp: Number(block.timestamp),
            from: tx.from,
            to: tx.to,
            value: tx.value.toString(),
            gasPrice: tx.gasPrice.toString(),
            gasUsed: receipt ? Number(receipt.gasUsed) : Number(tx.gas),
            isContractInteraction,
            isNFT: nftInfo.isNFT,
            nftStandard: nftInfo.nftStandard,
            input: tx.input
          });
          
          foundCount++;
        }
      }
      
      currentBlock--;
    } catch (error) {
      console.error(`Error fetching block ${currentBlock}:`, error.message);
      currentBlock--;
    }
  }

  return transactions.sort((a, b) => b.blockNumber - a.blockNumber);
}

module.exports = {
  getBlockNumber,
  getTransactionsForAddress,
  isContract,
  detectNFTTransaction
};
