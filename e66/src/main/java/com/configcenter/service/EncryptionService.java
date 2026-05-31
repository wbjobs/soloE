package com.configcenter.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

@Slf4j
@Service
public class EncryptionService {

    private static final String ALGORITHM = "AES";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH = 128;
    private static final String ENCRYPTED_PREFIX = "{ENC}";

    @Value("${config.encryption.key:ConfigCenterSecretKey256Bit12345678}")
    private String encryptionKey;

    public String encrypt(String plainText) {
        if (plainText == null || isEncrypted(plainText)) {
            return plainText;
        }

        try {
            byte[] keyBytes = getValidKeyBytes();
            SecretKeySpec secretKey = new SecretKeySpec(keyBytes, ALGORITHM);

            byte[] iv = new byte[GCM_IV_LENGTH];
            SecureRandom random = new SecureRandom();
            random.nextBytes(iv);

            GCMParameterSpec gcmParameterSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, gcmParameterSpec);

            byte[] encryptedBytes = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));

            byte[] combined = new byte[GCM_IV_LENGTH + encryptedBytes.length];
            System.arraycopy(iv, 0, combined, 0, GCM_IV_LENGTH);
            System.arraycopy(encryptedBytes, 0, combined, GCM_IV_LENGTH, encryptedBytes.length);

            String encoded = Base64.getEncoder().encodeToString(combined);
            return ENCRYPTED_PREFIX + encoded;
        } catch (Exception e) {
            log.error("Encryption failed", e);
            throw new RuntimeException("配置加密失败", e);
        }
    }

    public String decrypt(String encryptedText) {
        if (encryptedText == null || !isEncrypted(encryptedText)) {
            return encryptedText;
        }

        try {
            String base64Text = encryptedText.substring(ENCRYPTED_PREFIX.length());
            byte[] combined = Base64.getDecoder().decode(base64Text);

            byte[] iv = new byte[GCM_IV_LENGTH];
            byte[] encryptedBytes = new byte[combined.length - GCM_IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);
            System.arraycopy(combined, GCM_IV_LENGTH, encryptedBytes, 0, encryptedBytes.length);

            byte[] keyBytes = getValidKeyBytes();
            SecretKeySpec secretKey = new SecretKeySpec(keyBytes, ALGORITHM);

            GCMParameterSpec gcmParameterSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmParameterSpec);

            byte[] decryptedBytes = cipher.doFinal(encryptedBytes);
            return new String(decryptedBytes, StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.error("Decryption failed", e);
            throw new RuntimeException("配置解密失败", e);
        }
    }

    public boolean isEncrypted(String text) {
        return text != null && text.startsWith(ENCRYPTED_PREFIX);
    }

    private byte[] getValidKeyBytes() {
        byte[] keyBytes = encryptionKey.getBytes(StandardCharsets.UTF_8);
        if (keyBytes.length < 32) {
            byte[] paddedKey = new byte[32];
            System.arraycopy(keyBytes, 0, paddedKey, 0, keyBytes.length);
            return paddedKey;
        } else if (keyBytes.length > 32) {
            byte[] truncatedKey = new byte[32];
            System.arraycopy(keyBytes, 0, truncatedKey, 0, 32);
            return truncatedKey;
        }
        return keyBytes;
    }

    public void rotateKey(String newKey) {
        if (newKey == null || newKey.length() < 16) {
            throw new IllegalArgumentException("密钥长度至少16位");
        }
        this.encryptionKey = newKey;
        log.info("Encryption key rotated successfully");
    }
}
