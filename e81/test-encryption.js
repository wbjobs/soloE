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

function createTestPng() {
  const width = 256;
  const height = 256;
  
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
      const r = (x * 255 / width) & 0xFF;
      const g = (y * 255 / height) & 0xFF;
      const b = ((x + y) * 255 / (width + height)) & 0xFF;
      rawData.push(r, g, b);
    }
  }
  
  const compressed = zlib.deflateSync(Buffer.from(rawData), { level: 9 });
  const idat = createChunk('IDAT', compressed);
  
  const iend = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

async function testEncryption() {
  console.log('=== PNG 隐写加密功能测试 ===\n');
  
  const testPng = createTestPng();
  const testText = '这是一段加密测试文本！包含中文、English、数字123和符号!@#$%^&*()';
  const password = 'mySecretPassword123!';
  const wrongPassword = 'wrongPassword';
  
  console.log('测试图片大小:', (testPng.length / 1024).toFixed(2), 'KB');
  console.log('测试文本:', testText);
  console.log('测试密码:', password);
  console.log('');
  
  const testPngPath = path.join(__dirname, 'test-encryption.png');
  fs.writeFileSync(testPngPath, testPng);
  
  try {
    console.log('1. 测试加密编码...');
    const encodeForm = new FormData();
    encodeForm.append('image', fs.createReadStream(testPngPath));
    encodeForm.append('text', testText);
    encodeForm.append('useEncryption', 'true');
    encodeForm.append('password', password);
    
    const encodeResponse = await axios.post('http://localhost:3001/api/encode', encodeForm, {
      headers: encodeForm.getHeaders(),
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    
    const encodedPng = Buffer.from(encodeResponse.data);
    const encrypted = encodeResponse.headers['x-encrypted'] === 'true';
    console.log('   ✅ 编码成功!');
    console.log('   是否加密:', encrypted ? '是' : '否');
    console.log('   原始大小:', testPng.length, '字节, 编码后:', encodedPng.length, '字节');
    
    const encodedPngPath = path.join(__dirname, 'test-encryption-encoded.png');
    fs.writeFileSync(encodedPngPath, encodedPng);
    
    console.log('\n2. 测试使用正确密码解密...');
    const decodeForm1 = new FormData();
    decodeForm1.append('image', fs.createReadStream(encodedPngPath));
    decodeForm1.append('password', password);
    
    const decodeResponse1 = await axios.post('http://localhost:3001/api/decode', decodeForm1, {
      headers: decodeForm1.getHeaders(),
      timeout: 60000,
    });
    
    console.log('   ✅ 解码成功!');
    console.log('   提取文本:', decodeResponse1.data.text);
    console.log('   文本一致:', decodeResponse1.data.text === testText ? '✅ 是' : '❌ 否');
    
    console.log('\n3. 测试使用错误密码解密...');
    const decodeForm2 = new FormData();
    decodeForm2.append('image', fs.createReadStream(encodedPngPath));
    decodeForm2.append('password', wrongPassword);
    
    const decodeResponse2 = await axios.post('http://localhost:3001/api/decode', decodeForm2, {
      headers: decodeForm2.getHeaders(),
      timeout: 60000,
    });
    
    console.log('   解密结果:', decodeResponse2.data.success ? '❌ 意外成功' : '✅ 正确失败');
    console.log('   错误信息:', decodeResponse2.data.message);
    
    console.log('\n4. 测试不提供密码解密加密数据...');
    const decodeForm3 = new FormData();
    decodeForm3.append('image', fs.createReadStream(encodedPngPath));
    
    const decodeResponse3 = await axios.post('http://localhost:3001/api/decode', decodeForm3, {
      headers: decodeForm3.getHeaders(),
      timeout: 60000,
    });
    
    console.log('   解密结果:', decodeResponse3.data.success ? '❌ 意外成功' : '✅ 正确失败');
    console.log('   错误信息:', decodeResponse3.data.message);
    
    console.log('\n5. 测试不加密编码（向后兼容）...');
    const encodeForm2 = new FormData();
    encodeForm2.append('image', fs.createReadStream(testPngPath));
    encodeForm2.append('text', testText);
    encodeForm2.append('useEncryption', 'false');
    
    const encodeResponse2 = await axios.post('http://localhost:3001/api/encode', encodeForm2, {
      headers: encodeForm2.getHeaders(),
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    
    const encodedPng2 = Buffer.from(encodeResponse2.data);
    const encrypted2 = encodeResponse2.headers['x-encrypted'] === 'true';
    console.log('   ✅ 编码成功!');
    console.log('   是否加密:', encrypted2 ? '是' : '否');
    
    const encodedPngPath2 = path.join(__dirname, 'test-plain-encoded.png');
    fs.writeFileSync(encodedPngPath2, encodedPng2);
    
    console.log('\n6. 测试不使用密码解密未加密数据...');
    const decodeForm4 = new FormData();
    decodeForm4.append('image', fs.createReadStream(encodedPngPath2));
    
    const decodeResponse4 = await axios.post('http://localhost:3001/api/decode', decodeForm4, {
      headers: decodeForm4.getHeaders(),
      timeout: 60000,
    });
    
    console.log('   ✅ 解码成功!');
    console.log('   提取文本:', decodeResponse4.data.text);
    console.log('   文本一致:', decodeResponse4.data.text === testText ? '✅ 是' : '❌ 否');
    
    console.log('\n=== 测试总结 ===');
    const allPassed = 
      decodeResponse1.data.text === testText &&
      !decodeResponse2.data.success &&
      !decodeResponse3.data.success &&
      decodeResponse4.data.text === testText;
    
    console.log(allPassed ? '🎉 所有测试通过!' : '❌ 部分测试失败!');
    
    fs.unlinkSync(testPngPath);
    fs.unlinkSync(encodedPngPath);
    fs.unlinkSync(encodedPngPath2);
    
  } catch (error) {
    console.error('❌ 测试失败:', error.response?.data?.message || error.message);
    console.error('详细错误:', error);
    if (fs.existsSync(testPngPath)) fs.unlinkSync(testPngPath);
  }
}

testEncryption().catch(console.error);
