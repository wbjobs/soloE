use std::convert::TryInto;

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const STEG_MARKER: [u8; 4] = [0x73, 0x74, 0x65, 0x67];
const ENCRYPTED_FLAG: u8 = 0x01;
const PLAINTEXT_FLAG: u8 = 0x00;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

static mut OUTPUT_BUFFER: Vec<u8> = Vec::new();
static mut ERROR_MESSAGE: Vec<u8> = Vec::new();

fn read_be_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 == 1 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn set_error(msg: &str) {
    unsafe {
        ERROR_MESSAGE.clear();
        ERROR_MESSAGE.extend_from_slice(msg.as_bytes());
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5Cu8; 64];
    
    for i in 0..key.len().min(64) {
        ipad[i] ^= key[i];
        opad[i] ^= key[i];
    }
    
    let mut inner = Vec::new();
    inner.extend_from_slice(&ipad);
    inner.extend_from_slice(data);
    let inner_hash = sha256(&inner);
    
    let mut outer = Vec::new();
    outer.extend_from_slice(&opad);
    outer.extend_from_slice(&inner_hash);
    sha256(&outer)
}

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    
    let k: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    
    let mut padded = Vec::from(data);
    let orig_len_bits = (data.len() as u64) * 8;
    
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&orig_len_bits.to_be_bytes());
    
    for chunk in padded.chunks(64) {
        let mut w = [0u32; 64];
        for (i, bytes) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes(bytes.try_into().unwrap());
        }
        
        for i in 16..64 {
            let s0 = w[i-15].rotate_right(7) ^ w[i-15].rotate_right(18) ^ (w[i-15] >> 3);
            let s1 = w[i-2].rotate_right(17) ^ w[i-2].rotate_right(19) ^ (w[i-2] >> 10);
            w[i] = w[i-16].wrapping_add(s0).wrapping_add(w[i-7]).wrapping_add(s1);
        }
        
        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];
        
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(k[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    
    let mut result = [0u8; 32];
    for (i, val) in h.iter().enumerate() {
        result[i*4..(i+1)*4].copy_from_slice(&val.to_be_bytes());
    }
    result
}

fn derive_key(password: &[u8], salt: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let iterations = 1000u32;
    
    let mut t = Vec::new();
    t.extend_from_slice(salt);
    t.extend_from_slice(&[0u8, 0u8, 0u8, 1u8]);
    
    let mut u = hmac_sha256(password, &t);
    result.copy_from_slice(&u);
    
    for _ in 1..iterations {
        u = hmac_sha256(password, &u);
        for i in 0..32 {
            result[i] ^= u[i];
        }
    }
    
    result
}

fn aes256_encrypt_block(key: &[u8; 32], block: &[u8; 16]) -> [u8; 16] {
    let mut state = [0u8; 16];
    state.copy_from_slice(block);
    
    let nr = 14;
    let mut round_keys = vec![0u32; 4 * (nr + 1)];
    
    for i in 0..8 {
        round_keys[i] = u32::from_be_bytes(key[i*4..(i+1)*4].try_into().unwrap());
    }
    
    let rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    
    for i in 8..4*(nr+1) {
        let mut temp = round_keys[i-1];
        if i % 8 == 0 {
            temp = (temp << 8) | (temp >> 24);
            let mut bytes = temp.to_be_bytes();
            for j in 0..4 {
                bytes[j] = sbox(bytes[j]);
            }
            temp = u32::from_be_bytes(bytes);
            temp ^= (rcon[(i/8 - 1)] as u32) << 24;
        } else if i % 8 == 4 {
            let mut bytes = temp.to_be_bytes();
            for j in 0..4 {
                bytes[j] = sbox(bytes[j]);
            }
            temp = u32::from_be_bytes(bytes);
        }
        round_keys[i] = round_keys[i-8] ^ temp;
    }
    
    let mut state_u32 = [0u32; 4];
    for i in 0..4 {
        state_u32[i] = u32::from_be_bytes(state[i*4..(i+1)*4].try_into().unwrap());
    }
    
    for i in 0..4 {
        state_u32[i] ^= round_keys[i];
    }
    
    for round in 1..nr {
        for i in 0..4 {
            let bytes = state_u32[i].to_be_bytes();
            let substituted: [u8; 4] = [
                sbox(bytes[0]), sbox(bytes[1]), sbox(bytes[2]), sbox(bytes[3])
            ];
            state_u32[i] = u32::from_be_bytes(substituted);
        }
        
        let s0 = state_u32[0];
        state_u32[0] = state_u32[1];
        state_u32[1] = state_u32[2];
        state_u32[2] = state_u32[3];
        state_u32[3] = s0;
        
        for i in 0..4 {
            let b = state_u32[i].to_be_bytes();
            let mixed = mix_column(&b);
            state_u32[i] = u32::from_be_bytes(mixed);
        }
        
        for i in 0..4 {
            state_u32[i] ^= round_keys[round * 4 + i];
        }
    }
    
    for i in 0..4 {
        let bytes = state_u32[i].to_be_bytes();
        let substituted: [u8; 4] = [
            sbox(bytes[0]), sbox(bytes[1]), sbox(bytes[2]), sbox(bytes[3])
        ];
        state_u32[i] = u32::from_be_bytes(substituted);
    }
    
    let s0 = state_u32[0];
    state_u32[0] = state_u32[1];
    state_u32[1] = state_u32[2];
    state_u32[2] = state_u32[3];
    state_u32[3] = s0;
    
    for i in 0..4 {
        state_u32[i] ^= round_keys[nr * 4 + i];
    }
    
    for i in 0..4 {
        state[i*4..(i+1)*4].copy_from_slice(&state_u32[i].to_be_bytes());
    }
    
    state
}

fn sbox(byte: u8) -> u8 {
    let sbox: [u8; 256] = [
        0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
        0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
        0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
        0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
        0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
        0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
        0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
        0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
        0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
        0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
        0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
        0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
        0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
        0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
        0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
        0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
    ];
    sbox[byte as usize]
}

fn mix_column(col: &[u8; 4]) -> [u8; 4] {
    fn gmul(a: u8, b: u8) -> u8 {
        let mut result = 0u8;
        let mut a = a;
        let mut b = b;
        for _ in 0..8 {
            if b & 1 != 0 {
                result ^= a;
            }
            let hi = a & 0x80;
            a <<= 1;
            if hi != 0 {
                a ^= 0x1b;
            }
            b >>= 1;
        }
        result
    }
    
    [
        gmul(col[0], 2) ^ gmul(col[1], 3) ^ col[2] ^ col[3],
        col[0] ^ gmul(col[1], 2) ^ gmul(col[2], 3) ^ col[3],
        col[0] ^ col[1] ^ gmul(col[2], 2) ^ gmul(col[3], 3),
        gmul(col[0], 3) ^ col[1] ^ col[2] ^ gmul(col[3], 2),
    ]
}

fn aes256_ctr_encrypt(key: &[u8; 32], nonce: &[u8; 12], plaintext: &[u8]) -> Vec<u8> {
    let mut ciphertext = Vec::with_capacity(plaintext.len());
    let mut counter = 0u32;
    
    for chunk in plaintext.chunks(16) {
        let mut counter_block = [0u8; 16];
        counter_block[0..12].copy_from_slice(nonce);
        counter_block[12..16].copy_from_slice(&counter.to_be_bytes());
        
        let keystream = aes256_encrypt_block(key, &counter_block);
        
        for (i, &byte) in chunk.iter().enumerate() {
            ciphertext.push(byte ^ keystream[i]);
        }
        
        counter += 1;
    }
    
    ciphertext
}

fn aes256_gcm_encrypt(key: &[u8; 32], nonce: &[u8; 12], plaintext: &[u8]) -> (Vec<u8>, [u8; 16]) {
    let ciphertext = aes256_ctr_encrypt(key, nonce, plaintext);
    
    let mut auth_input = Vec::new();
    auth_input.extend_from_slice(nonce);
    auth_input.extend_from_slice(&ciphertext);
    auth_input.extend_from_slice(&(nonce.len() as u64).to_be_bytes());
    auth_input.extend_from_slice(&(ciphertext.len() as u64).to_be_bytes());
    
    let tag = hmac_sha256(key, &auth_input);
    let mut tag16 = [0u8; 16];
    tag16.copy_from_slice(&tag[0..16]);
    
    (ciphertext, tag16)
}

fn aes256_gcm_decrypt(key: &[u8; 32], nonce: &[u8; 12], ciphertext: &[u8], tag: &[u8; 16]) -> Result<Vec<u8>, &'static str> {
    let mut auth_input = Vec::new();
    auth_input.extend_from_slice(nonce);
    auth_input.extend_from_slice(ciphertext);
    auth_input.extend_from_slice(&(nonce.len() as u64).to_be_bytes());
    auth_input.extend_from_slice(&(ciphertext.len() as u64).to_be_bytes());
    
    let expected_tag = hmac_sha256(key, &auth_input);
    let mut expected_tag16 = [0u8; 16];
    expected_tag16.copy_from_slice(&expected_tag[0..16]);
    
    if expected_tag16 != *tag {
        return Err("Authentication failed: wrong password or corrupted data");
    }
    
    let plaintext = aes256_ctr_encrypt(key, nonce, ciphertext);
    Ok(plaintext)
}

fn encrypt_text(plaintext: &[u8], password: &[u8]) -> Vec<u8> {
    let mut salt = [0u8; SALT_LEN];
    for i in 0..SALT_LEN {
        salt[i] = ((i as u64) ^ 0x9E3779B97F4A7C15) as u8;
    }
    
    let key = derive_key(password, &salt);
    
    let mut nonce = [0u8; NONCE_LEN];
    for i in 0..NONCE_LEN {
        nonce[i] = ((i as u64) ^ 0xBF58476D1CE4E5B9) as u8;
    }
    
    let (ciphertext, tag) = aes256_gcm_encrypt(&key, &nonce, plaintext);
    
    let mut result = Vec::with_capacity(1 + SALT_LEN + NONCE_LEN + TAG_LEN + ciphertext.len());
    result.push(ENCRYPTED_FLAG);
    result.extend_from_slice(&salt);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&tag);
    result.extend_from_slice(&ciphertext);
    
    result
}

fn decrypt_text(encrypted: &[u8], password: &[u8]) -> Result<Vec<u8>, &'static str> {
    if encrypted.is_empty() {
        return Err("Empty encrypted data");
    }
    
    if encrypted[0] != ENCRYPTED_FLAG {
        return Err("Data is not encrypted");
    }
    
    let min_len = 1 + SALT_LEN + NONCE_LEN + TAG_LEN;
    if encrypted.len() < min_len {
        return Err("Encrypted data too short");
    }
    
    let salt = &encrypted[1..1 + SALT_LEN];
    let nonce = &encrypted[1 + SALT_LEN..1 + SALT_LEN + NONCE_LEN];
    let tag = &encrypted[1 + SALT_LEN + NONCE_LEN..1 + SALT_LEN + NONCE_LEN + TAG_LEN];
    let ciphertext = &encrypted[1 + SALT_LEN + NONCE_LEN + TAG_LEN..];
    
    let key = derive_key(password, salt.try_into().unwrap());
    
    let plaintext = aes256_gcm_decrypt(&key, nonce.try_into().unwrap(), ciphertext, tag.try_into().unwrap())?;
    
    Ok(plaintext)
}

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf = vec![0u8; size];
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    unsafe {
        let _ = Vec::from_raw_parts(ptr, size, size);
    }
}

#[no_mangle]
pub extern "C" fn encode(png_ptr: *const u8, png_len: usize, text_ptr: *const u8, text_len: usize, password_ptr: *const u8, password_len: usize) -> i32 {
    if png_len == 0 {
        set_error("Empty PNG data");
        return -1;
    }
    
    if png_len > 10 * 1024 * 1024 {
        set_error("PNG too large (max 10MB)");
        return -1;
    }
    
    unsafe {
        let png_data = std::slice::from_raw_parts(png_ptr, png_len);
        let text_bytes = std::slice::from_raw_parts(text_ptr, text_len);
        let password_bytes = if password_len > 0 {
            Some(std::slice::from_raw_parts(password_ptr, password_len))
        } else {
            None
        };
        
        if !png_data.starts_with(&PNG_SIGNATURE) {
            set_error("Invalid PNG signature");
            return -1;
        }
        
        let payload = if let Some(password) = password_bytes {
            if password.is_empty() {
                set_error("Password cannot be empty");
                return -1;
            }
            encrypt_text(text_bytes, password)
        } else {
            let mut result = Vec::with_capacity(text_bytes.len() + 1);
            result.push(PLAINTEXT_FLAG);
            result.extend_from_slice(text_bytes);
            result
        };
        
        let mut result = Vec::with_capacity(png_data.len() + payload.len() + 128);
        result.extend_from_slice(&PNG_SIGNATURE);
        
        let mut pos = 8;
        let mut iend_found = false;
        
        while pos < png_data.len() {
            if pos + 12 > png_data.len() {
                set_error("Invalid PNG chunk");
                return -1;
            }
            
            let length = read_be_u32(png_data, pos) as usize;
            
            if pos + 12 + length > png_data.len() {
                set_error("Invalid PNG chunk length");
                return -1;
            }
            
            let chunk_type = &png_data[pos + 4..pos + 8];
            
            if chunk_type == b"IEND" {
                let hidden_data = build_hidden_chunk(&payload);
                result.extend_from_slice(&hidden_data);
                iend_found = true;
            }
            
            result.extend_from_slice(&png_data[pos..pos + 12 + length]);
            pos += 12 + length;
        }
        
        if !iend_found {
            set_error("Invalid PNG: no IEND chunk");
            return -1;
        }
        
        let result_len = result.len();
        OUTPUT_BUFFER = result;
        result_len as i32
    }
}

fn build_hidden_chunk(text_bytes: &[u8]) -> Vec<u8> {
    let mut chunk_data = Vec::with_capacity(text_bytes.len() + 8);
    chunk_data.extend_from_slice(&STEG_MARKER);
    chunk_data.extend_from_slice(&(text_bytes.len() as u32).to_be_bytes());
    chunk_data.extend_from_slice(text_bytes);
    
    let mut chunk = Vec::with_capacity(chunk_data.len() + 12);
    chunk.extend_from_slice(&(chunk_data.len() as u32).to_be_bytes());
    chunk.extend_from_slice(b"stEg");
    chunk.extend_from_slice(&chunk_data);
    
    let crc_input = [&b"stEg"[..], &chunk_data[..]].concat();
    let crc = crc32(&crc_input);
    chunk.extend_from_slice(&crc.to_be_bytes());
    
    chunk
}

#[no_mangle]
pub extern "C" fn decode(png_ptr: *const u8, png_len: usize, password_ptr: *const u8, password_len: usize) -> i32 {
    if png_len == 0 {
        set_error("Empty PNG data");
        return -1;
    }
    
    if png_len > 10 * 1024 * 1024 {
        set_error("PNG too large (max 10MB)");
        return -1;
    }
    
    unsafe {
        let png_data = std::slice::from_raw_parts(png_ptr, png_len);
        let password_bytes = if password_len > 0 {
            Some(std::slice::from_raw_parts(password_ptr, password_len))
        } else {
            None
        };
        
        if !png_data.starts_with(&PNG_SIGNATURE) {
            set_error("Invalid PNG signature");
            return -1;
        }
        
        let mut pos = 8;
        
        while pos < png_data.len() {
            if pos + 12 > png_data.len() {
                set_error("Invalid PNG chunk");
                return -1;
            }
            
            let length = read_be_u32(png_data, pos) as usize;
            
            if pos + 12 + length > png_data.len() {
                set_error("Invalid PNG chunk length");
                return -1;
            }
            
            let chunk_type = &png_data[pos + 4..pos + 8];
            
            if chunk_type == b"stEg" {
                let chunk_data = &png_data[pos + 8..pos + 8 + length];
                
                if chunk_data.len() < 8 {
                    set_error("Invalid hidden chunk");
                    return -1;
                }
                
                let marker = &chunk_data[0..4];
                if marker != &STEG_MARKER {
                    pos += 12 + length;
                    continue;
                }
                
                let text_len = read_be_u32(chunk_data, 4) as usize;
                if 8 + text_len > chunk_data.len() {
                    set_error("Invalid hidden data length");
                    return -1;
                }
                
                let payload = &chunk_data[8..8 + text_len];
                if payload.is_empty() {
                    set_error("Empty payload");
                    return -1;
                }
                
                let flag = payload[0];
                let data = &payload[1..];
                
                let text_bytes = if flag == ENCRYPTED_FLAG {
                    let password = match password_bytes {
                        Some(p) if !p.is_empty() => p,
                        _ => {
                            set_error("This image contains encrypted data. Please provide the password.");
                            return -1;
                        }
                    };
                    
                    match decrypt_text(payload, password) {
                        Ok(bytes) => bytes,
                        Err(msg) => {
                            set_error(msg);
                            return -1;
                        }
                    }
                } else if flag == PLAINTEXT_FLAG {
                    data.to_vec()
                } else {
                    set_error("Invalid data format");
                    return -1;
                };
                
                match String::from_utf8(text_bytes) {
                    Ok(text) => {
                        OUTPUT_BUFFER = text.into_bytes();
                        return OUTPUT_BUFFER.len() as i32;
                    }
                    Err(_) => {
                        set_error("UTF-8 decoding error");
                        return -1;
                    }
                }
            }
            
            pos += 12 + length;
        }
        
        set_error("No hidden data found");
        -1
    }
}

#[no_mangle]
pub extern "C" fn get_output_ptr() -> *const u8 {
    unsafe { OUTPUT_BUFFER.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_output_len() -> i32 {
    unsafe { OUTPUT_BUFFER.len() as i32 }
}

#[no_mangle]
pub extern "C" fn get_error_ptr() -> *const u8 {
    unsafe { ERROR_MESSAGE.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_error_len() -> i32 {
    unsafe { ERROR_MESSAGE.len() as i32 }
}

#[no_mangle]
pub extern "C" fn free_buffers() {
    unsafe {
        OUTPUT_BUFFER.clear();
        OUTPUT_BUFFER.shrink_to_fit();
        ERROR_MESSAGE.clear();
        ERROR_MESSAGE.shrink_to_fit();
    }
}
