use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use sha2::{Sha256, Digest};
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Encryption error: {0}")]
    Encryption(String),
    #[error("Decryption error: {0}")]
    Decryption(String),
    #[error("Invalid file format")]
    InvalidFormat,
    #[error("File integrity check failed: hash mismatch")]
    HashMismatch,
}

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
const TAG_LEN: usize = 16;
const HASH_LEN: usize = 32;
const ITERATIONS: u32 = 100_000;

fn derive_key(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, ITERATIONS, &mut key);
    key
}

fn compute_sha256(data: &[u8]) -> [u8; HASH_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; HASH_LEN];
    hash.copy_from_slice(&result);
    hash
}

pub fn encrypt_file(file_path: &str, password: &str) -> Result<(), CryptoError> {
    let path = Path::new(file_path);
    let data = fs::read(path)?;

    let original_hash = compute_sha256(&data);

    let mut salt = [0u8; SALT_LEN];
    aes_gcm::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut salt);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    aes_gcm::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut nonce_bytes);

    let key = derive_key(password, &salt);
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext_with_tag = cipher
        .encrypt(nonce, data.as_ref())
        .map_err(|e| CryptoError::Encryption(format!("AES-GCM encryption failed: {}", e)))?;

    let mut encrypted_data = Vec::with_capacity(
        SALT_LEN + NONCE_LEN + HASH_LEN + ciphertext_with_tag.len()
    );
    encrypted_data.extend_from_slice(&salt);
    encrypted_data.extend_from_slice(&nonce_bytes);
    encrypted_data.extend_from_slice(&original_hash);
    encrypted_data.extend_from_slice(&ciphertext_with_tag);

    let new_path = path.with_extension("enc");
    fs::write(&new_path, encrypted_data)?;
    fs::remove_file(path)?;

    Ok(())
}

pub fn decrypt_file(file_path: &str, password: &str) -> Result<(), CryptoError> {
    let path = Path::new(file_path);
    let data = fs::read(path)?;

    let min_size = SALT_LEN + NONCE_LEN + HASH_LEN + TAG_LEN;
    if data.len() < min_size {
        return Err(CryptoError::InvalidFormat);
    }

    let salt = &data[..SALT_LEN];
    let nonce_bytes = &data[SALT_LEN..SALT_LEN + NONCE_LEN];
    let original_hash = &data[SALT_LEN + NONCE_LEN..SALT_LEN + NONCE_LEN + HASH_LEN];
    let ciphertext_with_tag = &data[SALT_LEN + NONCE_LEN + HASH_LEN..];

    let key = derive_key(password, salt);
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext_with_tag)
        .map_err(|e| CryptoError::Decryption(format!("AES-GCM decryption failed: {}", e)))?;

    let decrypted_hash = compute_sha256(&plaintext);
    
    if decrypted_hash != original_hash {
        return Err(CryptoError::HashMismatch);
    }

    let original_path = path.with_extension("");
    fs::write(&original_path, plaintext)?;
    fs::remove_file(path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_encrypt_decrypt_cycle() {
        let dir = tempdir().unwrap();
        let test_content = b"Hello, World! This is a test file for encryption.";
        let test_file = dir.path().join("test.txt");
        fs::write(&test_file, test_content).unwrap();

        let password = "test_password_123";

        encrypt_file(test_file.to_str().unwrap(), password).unwrap();

        let encrypted_file = dir.path().join("test.enc");
        assert!(encrypted_file.exists());
        assert!(!test_file.exists());

        decrypt_file(encrypted_file.to_str().unwrap(), password).unwrap();

        assert!(test_file.exists());
        assert!(!encrypted_file.exists());

        let decrypted_content = fs::read(&test_file).unwrap();
        assert_eq!(decrypted_content, test_content);
    }

    #[test]
    fn test_wrong_password() {
        let dir = tempdir().unwrap();
        let test_content = b"Secret content";
        let test_file = dir.path().join("test.txt");
        fs::write(&test_file, test_content).unwrap();

        encrypt_file(test_file.to_str().unwrap(), "correct_password").unwrap();

        let encrypted_file = dir.path().join("test.enc");
        let result = decrypt_file(encrypted_file.to_str().unwrap(), "wrong_password");
        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_file() {
        let dir = tempdir().unwrap();
        let test_content = b"Secret content";
        let test_file = dir.path().join("test.txt");
        fs::write(&test_file, test_content).unwrap();

        encrypt_file(test_file.to_str().unwrap(), "password").unwrap();

        let encrypted_file = dir.path().join("test.enc");
        let mut encrypted_data = fs::read(&encrypted_file).unwrap();
        
        let last_byte = encrypted_data.len() - 1;
        encrypted_data[last_byte] ^= 0xFF;
        fs::write(&encrypted_file, encrypted_data).unwrap();

        let result = decrypt_file(encrypted_file.to_str().unwrap(), "password");
        assert!(result.is_err());
    }
}
