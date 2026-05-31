import fs = require('fs');
import path = require('path');

const MAX_PNG_SIZE = 10 * 1024 * 1024;
const MEMORY_PAGES = 1024;

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  dealloc: (ptr: number, size: number) => void;
  encode: (pngPtr: number, pngLen: number, textPtr: number, textLen: number, passwordPtr: number, passwordLen: number) => number;
  decode: (pngPtr: number, pngLen: number, passwordPtr: number, passwordLen: number) => number;
  get_output_ptr: () => number;
  get_output_len: () => number;
  get_error_ptr: () => number;
  get_error_len: () => number;
  free_buffers: () => void;
}

let wasmInstance: WasmExports | null = null;

async function loadWasm(): Promise<WasmExports> {
  if (wasmInstance) {
    return wasmInstance;
  }

  const wasmPath = path.join(__dirname, '..', 'wasm', 'stegano_lib.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  const memory = new WebAssembly.Memory({
    initial: MEMORY_PAGES,
    maximum: MEMORY_PAGES * 4,
  });
  
  const importObject = {
    env: {
      memory: memory,
      __stack_pointer: 1024 * 1024,
    },
  };
  
  try {
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, importObject);
    wasmInstance = wasmModule.instance.exports as unknown as WasmExports;
  } catch (e) {
    const wasmModule = await WebAssembly.instantiate(wasmBuffer, {});
    wasmInstance = wasmModule.instance.exports as unknown as WasmExports;
  }
  
  return wasmInstance;
}

function copyToMemory(wasm: WasmExports, data: Uint8Array): number {
  const required = data.length;
  const ptr = wasm.alloc(required);
  
  let memoryView = new Uint8Array(wasm.memory.buffer);
  
  while (ptr + required > memoryView.length) {
    wasm.memory.grow(1);
    memoryView = new Uint8Array(wasm.memory.buffer);
  }
  
  memoryView.set(data, ptr);
  return ptr;
}

function readFromMemory(wasm: WasmExports, ptr: number, length: number): Uint8Array {
  const memoryView = new Uint8Array(wasm.memory.buffer);
  
  if (ptr + length > memoryView.length) {
    throw new Error('Memory access out of bounds');
  }
  
  const result = new Uint8Array(length);
  result.set(memoryView.slice(ptr, ptr + length));
  return result;
}

function getErrorMessage(wasm: WasmExports): string {
  try {
    const errorPtr = wasm.get_error_ptr();
    const errorLen = wasm.get_error_len();
    if (errorLen <= 0 || errorPtr === 0) {
      return 'Unknown error';
    }
    const errorBytes = readFromMemory(wasm, errorPtr, errorLen);
    return Buffer.from(errorBytes).toString('utf8');
  } catch {
    return 'Unknown error';
  }
}

function ensureMemoryCapacity(wasm: WasmExports, requiredBytes: number): void {
  const currentMemory = new Uint8Array(wasm.memory.buffer);
  const requiredPages = Math.ceil(requiredBytes / 65536);
  const currentPages = currentMemory.length / 65536;
  
  if (requiredPages > currentPages) {
    try {
      wasm.memory.grow(requiredPages - currentPages);
    } catch (e) {
      throw new Error('Failed to grow WASM memory');
    }
  }
}

export async function encodePng(pngData: Buffer, text: string, password?: string): Promise<Buffer> {
  if (pngData.length === 0) {
    throw new Error('Empty PNG data');
  }
  
  if (pngData.length > MAX_PNG_SIZE) {
    throw new Error(`PNG too large: ${(pngData.length / 1024 / 1024).toFixed(2)}MB (max ${MAX_PNG_SIZE / 1024 / 1024}MB)`);
  }
  
  const wasm = await loadWasm();
  
  const textBytes = Buffer.from(text, 'utf8');
  const passwordBytes = password && password.length > 0 ? Buffer.from(password, 'utf8') : null;
  const outputSize = pngData.length + textBytes.length + 4096 + (passwordBytes ? 128 : 0);
  
  ensureMemoryCapacity(wasm, outputSize * 2);
  
  let pngPtr = 0;
  let textPtr = 0;
  let passwordPtr = 0;
  
  try {
    pngPtr = copyToMemory(wasm, pngData);
    textPtr = copyToMemory(wasm, textBytes);
    
    if (passwordBytes) {
      passwordPtr = copyToMemory(wasm, passwordBytes);
    }
    
    const resultLen = wasm.encode(
      pngPtr, pngData.length,
      textPtr, textBytes.length,
      passwordPtr, passwordBytes ? passwordBytes.length : 0
    );
    
    if (resultLen < 0) {
      const errorMsg = getErrorMessage(wasm);
      wasm.free_buffers();
      throw new Error(errorMsg);
    }
    
    const outputPtr = wasm.get_output_ptr();
    const actualOutputLen = wasm.get_output_len();
    
    if (outputPtr === 0 || actualOutputLen <= 0) {
      wasm.free_buffers();
      throw new Error('Encode produced empty output');
    }
    
    ensureMemoryCapacity(wasm, outputPtr + actualOutputLen);
    
    const outputData = readFromMemory(wasm, outputPtr, actualOutputLen);
    const result = Buffer.from(outputData);
    
    wasm.free_buffers();
    return result;
  } finally {
    if (pngPtr !== 0) {
      try { wasm.dealloc(pngPtr, pngData.length); } catch {}
    }
    if (textPtr !== 0) {
      try { wasm.dealloc(textPtr, textBytes.length); } catch {}
    }
    if (passwordPtr !== 0 && passwordBytes) {
      try { wasm.dealloc(passwordPtr, passwordBytes.length); } catch {}
    }
  }
}

export async function decodePng(pngData: Buffer, password?: string): Promise<string> {
  if (pngData.length === 0) {
    throw new Error('Empty PNG data');
  }
  
  if (pngData.length > MAX_PNG_SIZE) {
    throw new Error(`PNG too large: ${(pngData.length / 1024 / 1024).toFixed(2)}MB (max ${MAX_PNG_SIZE / 1024 / 1024}MB)`);
  }
  
  const wasm = await loadWasm();
  ensureMemoryCapacity(wasm, pngData.length * 2 + 65536);
  
  let pngPtr = 0;
  let passwordPtr = 0;
  const passwordBytes = password && password.length > 0 ? Buffer.from(password, 'utf8') : null;
  
  try {
    pngPtr = copyToMemory(wasm, pngData);
    
    if (passwordBytes) {
      passwordPtr = copyToMemory(wasm, passwordBytes);
    }
    
    const resultLen = wasm.decode(
      pngPtr, pngData.length,
      passwordPtr, passwordBytes ? passwordBytes.length : 0
    );
    
    if (resultLen < 0) {
      const errorMsg = getErrorMessage(wasm);
      wasm.free_buffers();
      throw new Error(errorMsg);
    }
    
    const outputPtr = wasm.get_output_ptr();
    const actualOutputLen = wasm.get_output_len();
    
    if (outputPtr === 0 || actualOutputLen <= 0) {
      wasm.free_buffers();
      throw new Error('Decode produced empty output');
    }
    
    ensureMemoryCapacity(wasm, outputPtr + actualOutputLen);
    
    const outputData = readFromMemory(wasm, outputPtr, actualOutputLen);
    const text = Buffer.from(outputData).toString('utf8');
    
    wasm.free_buffers();
    return text;
  } finally {
    if (pngPtr !== 0) {
      try { wasm.dealloc(pngPtr, pngData.length); } catch {}
    }
    if (passwordPtr !== 0 && passwordBytes) {
      try { wasm.dealloc(passwordPtr, passwordBytes.length); } catch {}
    }
  }
}
