const MAGIC_NUMBER = new Uint8Array([0x53, 0x54, 0x45, 0x47]);
const MAGIC_LENGTH = MAGIC_NUMBER.length;
const LENGTH_FIELD_SIZE = 4;
const CHECKSUM_SIZE = 4;
const HEADER_SIZE = MAGIC_LENGTH + LENGTH_FIELD_SIZE + CHECKSUM_SIZE;

function calculateChecksum(data) {
  let checksum = 0;
  for (let i = 0; i < data.length; i++) {
    checksum = ((checksum << 5) - checksum + data[i]) | 0;
  }
  return checksum >>> 0;
}

function writeBitToPixel(pixels, bitIndex, bitValue) {
  const pixelIndex = bitIndex * 4;
  if (pixelIndex + 2 >= pixels.length) {
    throw new Error('Pixel buffer too small');
  }
  pixels[pixelIndex + 2] = (pixels[pixelIndex + 2] & 0xFE) | bitValue;
}

function readBitFromPixel(pixels, bitIndex) {
  const pixelIndex = bitIndex * 4;
  if (pixelIndex + 2 >= pixels.length) {
    throw new Error('Pixel buffer too small');
  }
  return pixels[pixelIndex + 2] & 1;
}

function writeBytes(pixels, startBitIndex, bytes, onProgress) {
  let bitIndex = startBitIndex;
  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit++) {
      const bitValue = (byte >> (7 - bit)) & 1;
      writeBitToPixel(pixels, bitIndex, bitValue);
      bitIndex++;
      if (onProgress) onProgress(bitIndex);
    }
  }
  return bitIndex;
}

function readBytes(pixels, startBitIndex, length) {
  const bytes = new Uint8Array(length);
  let bitIndex = startBitIndex;
  for (let i = 0; i < length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const bitValue = readBitFromPixel(pixels, bitIndex);
      bytes[i] = (bytes[i] << 1) | bitValue;
      bitIndex++;
    }
  }
  return { bytes, nextBitIndex: bitIndex };
}

export function encodeMessage(pixels, width, height, message, onProgress) {
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);
  const messageLen = messageBytes.length;

  const maxBytes = Math.floor((width * height) / 8);
  if (messageLen + HEADER_SIZE > maxBytes) {
    throw new Error(`Message too long. Max: ${maxBytes - HEADER_SIZE} bytes, got: ${messageLen} bytes`);
  }

  const checksum = calculateChecksum(messageBytes);

  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, messageLen, false);

  const checksumBytes = new Uint8Array(4);
  new DataView(checksumBytes.buffer).setUint32(0, checksum, false);

  let bitIndex = 0;

  bitIndex = writeBytes(pixels, bitIndex, MAGIC_NUMBER, onProgress);
  bitIndex = writeBytes(pixels, bitIndex, lenBytes, onProgress);
  bitIndex = writeBytes(pixels, bitIndex, checksumBytes, onProgress);
  writeBytes(pixels, bitIndex, messageBytes, onProgress);

  return pixels;
}

export function decodeMessage(pixels, width, height) {
  let bitIndex = 0;

  const { bytes: magicBytes, nextBitIndex: afterMagic } = readBytes(pixels, bitIndex, MAGIC_LENGTH);
  bitIndex = afterMagic;

  for (let i = 0; i < MAGIC_LENGTH; i++) {
    if (magicBytes[i] !== MAGIC_NUMBER[i]) {
      throw new Error('No hidden message found: invalid magic number');
    }
  }

  const { bytes: lenBytes, nextBitIndex: afterLen } = readBytes(pixels, bitIndex, LENGTH_FIELD_SIZE);
  bitIndex = afterLen;

  const messageLen = new DataView(lenBytes.buffer).getUint32(0, false);

  const maxBytes = Math.floor((width * height) / 8) - HEADER_SIZE;
  if (messageLen > maxBytes || messageLen === 0) {
    throw new Error('No hidden message found or message corrupted');
  }

  const { bytes: checksumBytes, nextBitIndex: afterChecksum } = readBytes(pixels, bitIndex, CHECKSUM_SIZE);
  bitIndex = afterChecksum;

  const expectedChecksum = new DataView(checksumBytes.buffer).getUint32(0, false);

  const { bytes: messageBytes } = readBytes(pixels, bitIndex, messageLen);

  const actualChecksum = calculateChecksum(messageBytes);
  if (actualChecksum !== expectedChecksum) {
    throw new Error('Message corrupted: checksum mismatch');
  }

  const decoder = new TextDecoder();
  return decoder.decode(messageBytes);
}

export function getMaxMessageSize(width, height) {
  return Math.floor((width * height) / 8) - HEADER_SIZE;
}
