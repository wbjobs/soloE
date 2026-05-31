export interface EncryptedFileData {
  encryptedChunks: ArrayBuffer[];
  fileName: string;
  fileSize: number;
  fileType: string;
  encryptedKey: ArrayBuffer;
  iv: Uint8Array;
  authTag: Uint8Array;
  totalChunks: number;
}

export interface FileTransferInfo {
  fileName: string;
  fileSize: number;
  fileType: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
  totalChunks: number;
  transferId: string;
}

const RSA_KEY_ALGORITHM = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  hash: { name: 'SHA-256' },
};

const AES_KEY_ALGORITHM = {
  name: 'AES-GCM',
  length: 256,
};

export async function generateRSAKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    RSA_KEY_ALGORITHM,
    true,
    ['encrypt', 'decrypt']
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('spki', key);
  return arrayBufferToBase64(exported);
}

export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey('pkcs8', key);
  return arrayBufferToBase64(exported);
}

export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'spki',
    keyData,
    RSA_KEY_ALGORITHM,
    false,
    ['encrypt']
  );
}

export async function importPrivateKey(base64Key: string): Promise<CryptoKey> {
  const keyData = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    'pkcs8',
    keyData,
    RSA_KEY_ALGORITHM,
    false,
    ['decrypt']
  );
}

export async function generateAESKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.generateKey(AES_KEY_ALGORITHM, true, ['encrypt', 'decrypt']);
}

export async function encryptAESKey(aesKey: CryptoKey, rsaPublicKey: CryptoKey): Promise<ArrayBuffer> {
  const exportedAESKey = await window.crypto.subtle.exportKey('raw', aesKey);
  return await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    rsaPublicKey,
    exportedAESKey
  );
}

export async function decryptAESKey(encryptedKey: ArrayBuffer, rsaPrivateKey: CryptoKey): Promise<CryptoKey> {
  const decryptedKey = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    rsaPrivateKey,
    encryptedKey
  );
  return await window.crypto.subtle.importKey(
    'raw',
    decryptedKey,
    AES_KEY_ALGORITHM,
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(data: ArrayBuffer, aesKey: CryptoKey): Promise<{ encryptedData: ArrayBuffer; iv: Uint8Array; authTag: Uint8Array }> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    data
  );
  
  const authTag = new Uint8Array(encrypted, encrypted.byteLength - 16, 16);
  const encryptedData = encrypted.slice(0, encrypted.byteLength - 16);
  
  return { encryptedData, iv, authTag };
}

export async function decryptData(
  encryptedData: ArrayBuffer,
  aesKey: CryptoKey,
  iv: Uint8Array,
  authTag: Uint8Array
): Promise<ArrayBuffer> {
  const combined = new Uint8Array(encryptedData.byteLength + authTag.byteLength);
  combined.set(new Uint8Array(encryptedData), 0);
  combined.set(authTag, encryptedData.byteLength);
  
  return await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    combined
  );
}

export async function encryptFile(file: File): Promise<{ encryptedData: ArrayBuffer; aesKey: CryptoKey; iv: Uint8Array; authTag: Uint8Array }> {
  const arrayBuffer = await file.arrayBuffer();
  const aesKey = await generateAESKey();
  const { encryptedData, iv, authTag } = await encryptData(arrayBuffer, aesKey);
  return { encryptedData, aesKey, iv, authTag };
}

export async function decryptFile(
  encryptedData: ArrayBuffer,
  aesKey: CryptoKey,
  iv: Uint8Array,
  authTag: Uint8Array
): Promise<Blob> {
  const decrypted = await decryptData(encryptedData, aesKey, iv, authTag);
  return new Blob([decrypted]);
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function splitIntoChunks(data: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  const view = new Uint8Array(data);
  for (let i = 0; i < view.length; i += chunkSize) {
    chunks.push(view.slice(i, i + chunkSize).buffer);
  }
  return chunks;
}

export function concatenateChunks(chunks: ArrayBuffer[]): ArrayBuffer {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}
