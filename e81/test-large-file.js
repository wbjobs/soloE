const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');
const FormData = require('form-data');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (~crc) >>> 0;
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crcValue = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crcValue, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function createLargePng(targetSizeMB) {
  const width = 2048;
  const height = 2048;
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  
  const ihdr = createChunk('IHDR', ihdrData);
  
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const offset = rowOffset + 1 + x * 3;
      rawData[offset] = (x * 255 / width) & 0xFF;
      rawData[offset + 1] = (y * 255 / height) & 0xFF;
      rawData[offset + 2] = ((x + y) * 255 / (width + height)) & 0xFF;
    }
  }
  
  let compressed = zlib.deflateSync(rawData, { level: 9 });
  
  const targetSize = targetSizeMB * 1024 * 1024;
  const overhead = PNG_SIGNATURE.length + ihdr.length + 12 + 12;
  let paddingNeeded = targetSize - compressed.length - overhead;
  
  if (paddingNeeded > 0) {
    const paddingChunkData = Buffer.alloc(Math.max(0, paddingNeeded - 12), 0);
    const paddingChunk = createChunk('zTXt', paddingChunkData);
    const idat = createChunk('IDAT', compressed);
    const iend = createChunk('IEND', Buffer.alloc(0));
    return Buffer.concat([PNG_SIGNATURE, ihdr, idat, paddingChunk, iend]);
  } else {
    const idat = createChunk('IDAT', compressed);
    const iend = createChunk('IEND', Buffer.alloc(0));
    return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
  }
}

async function testLargeImage(sizeMB) {
  console.log(`\n=== 测试 ${sizeMB}MB 图片 ===`);
  
  const pngData = createLargePng(sizeMB);
  console.log(`生成图片大小: ${(pngData.length / 1024 / 1024).toFixed(2)}MB`);
  
  const testText = '这是一段用于测试大图片隐写的中文文本。包含各种字符：测试123，符号!@#$%^&*()，以及换行符。\n第二行内容。\n第三行内容。结束。';
  console.log(`测试文本长度: ${testText.length} 字符`);
  
  const testPngPath = path.join(__dirname, `test-large-${sizeMB}mb.png`);
  fs.writeFileSync(testPngPath, pngData);
  
  try {
    console.log('\n1. 测试编码 API...');
    const encodeForm = new FormData();
    encodeForm.append('image', fs.createReadStream(testPngPath));
    encodeForm.append('text', testText);
    
    const startTime = Date.now();
    const encodeResponse = await axios.post('http://localhost:3001/api/encode', encodeForm, {
      headers: encodeForm.getHeaders(),
      responseType: 'arraybuffer',
      timeout: 120000,
    });
    const encodeTime = Date.now() - startTime;
    
    const encodedPng = Buffer.from(encodeResponse.data);
    console.log(`   ✅ 编码成功! 耗时: ${encodeTime}ms`);
    console.log(`   原始大小: ${(pngData.length / 1024 / 1024).toFixed(2)}MB, 编码后: ${(encodedPng.length / 1024 / 1024).toFixed(2)}MB`);
    
    const encodedPngPath = path.join(__dirname, `test-large-${sizeMB}mb-encoded.png`);
    fs.writeFileSync(encodedPngPath, encodedPng);
    
    console.log('\n2. 测试解码 API...');
    const decodeForm = new FormData();
    decodeForm.append('image', fs.createReadStream(encodedPngPath));
    
    const decodeStartTime = Date.now();
    const decodeResponse = await axios.post('http://localhost:3001/api/decode', decodeForm, {
      headers: decodeForm.getHeaders(),
      timeout: 120000,
    });
    const decodeTime = Date.now() - decodeStartTime;
    
    console.log(`   ✅ 解码成功! 耗时: ${decodeTime}ms`);
    console.log(`   提取文本: ${decodeResponse.data.text.substring(0, 50)}...`);
    console.log(`   消息: ${decodeResponse.data.message}`);
    
    console.log('\n3. 文本对比:');
    const original = testText;
    const extracted = decodeResponse.data.text;
    const match = original === extracted;
    console.log(`   是否一致: ${match ? '✅ 完全一致' : '❌ 存在差异'}`);
    
    fs.unlinkSync(testPngPath);
    fs.unlinkSync(encodedPngPath);
    
    return match;
    
  } catch (error) {
    console.error(`   ❌ 测试失败:`, error.response?.data?.message || error.message);
    if (fs.existsSync(testPngPath)) fs.unlinkSync(testPngPath);
    return false;
  }
}

async function runTests() {
  console.log('=== PNG 隐写大文件测试 ===\n');
  
  const testSizes = [1, 2, 3, 4.5];
  const results = [];
  
  for (const size of testSizes) {
    const success = await testLargeImage(size);
    results.push({ size, success });
  }
  
  console.log('\n=== 测试总结 ===');
  for (const result of results) {
    console.log(`${result.size}MB: ${result.success ? '✅ 通过' : '❌ 失败'}`);
  }
  
  const passed = results.filter(r => r.success).length;
  console.log(`\n总计: ${passed}/${results.length} 测试通过`);
}

runTests().catch(console.error);
