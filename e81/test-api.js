const fs = require('fs');
const path = require('path');
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

function createTestPng() {
  const width = 4;
  const height = 4;
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  
  const ihdr = createChunk('IHDR', ihdrData);
  
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0);
    for (let x = 0; x < width; x++) {
      rawData.push(255, 0, 0);
    }
  }
  
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = createChunk('IDAT', compressed);
  
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

async function testApi() {
  console.log('=== PNG 隐写 API 测试 ===\n');
  
  const testPng = createTestPng();
  const testText = '你好，世界！Hello, World! 这是一段测试文本。';
  
  console.log('1. 创建测试 PNG 图片');
  console.log('   图片大小:', testPng.length, '字节');
  
  const testPngPath = path.join(__dirname, 'test.png');
  fs.writeFileSync(testPngPath, testPng);
  console.log('   已保存到:', testPngPath);
  
  console.log('\n2. 测试文本:', testText);
  console.log('   文本长度:', testText.length, '字符');
  console.log('   字节长度:', Buffer.from(testText, 'utf8').length, '字节');
  
  console.log('\n3. 测试编码 API...');
  const encodeForm = new FormData();
  encodeForm.append('image', fs.createReadStream(testPngPath));
  encodeForm.append('text', testText);
  
  try {
    const encodeResponse = await axios.post('http://localhost:3001/api/encode', encodeForm, {
      headers: encodeForm.getHeaders(),
      responseType: 'arraybuffer'
    });
    
    const encodedPng = Buffer.from(encodeResponse.data);
    console.log('   ✅ 编码成功!');
    console.log('   编码后图片大小:', encodedPng.length, '字节');
    
    const encodedPngPath = path.join(__dirname, 'test-encoded.png');
    fs.writeFileSync(encodedPngPath, encodedPng);
    console.log('   已保存到:', encodedPngPath);
    
    console.log('\n4. 测试解码 API...');
    const decodeForm = new FormData();
    decodeForm.append('image', fs.createReadStream(encodedPngPath));
    
    const decodeResponse = await axios.post('http://localhost:3001/api/decode', decodeForm, {
      headers: decodeForm.getHeaders()
    });
    
    console.log('   ✅ 解码成功!');
    console.log('   提取文本:', decodeResponse.data.text);
    console.log('   消息:', decodeResponse.data.message);
    
    console.log('\n5. 文本对比:');
    const original = testText;
    const extracted = decodeResponse.data.text;
    
    console.log('   原始文本:', original);
    console.log('   提取文本:', extracted);
    console.log('   是否一致:', original === extracted ? '✅ 完全一致' : '❌ 存在差异');
    
    if (original === extracted) {
      console.log('\n🎉 所有测试通过! 隐写功能正常工作。');
    } else {
      console.log('\n❌ 测试失败: 文本不一致');
    }
    
  } catch (error) {
    console.error('   ❌ 测试失败:', error.response?.data?.message || error.message);
  }
  
  fs.unlinkSync(testPngPath);
  if (fs.existsSync(path.join(__dirname, 'test-encoded.png'))) {
    fs.unlinkSync(path.join(__dirname, 'test-encoded.png'));
  }
}

testApi();
