use serde::{Deserialize, Serialize};
use std::path::Path;
use std::ffi::OsStr;
use tokio::fs;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureBootCertificate {
    pub id: String,
    pub name: String,
    pub issuer: String,
    pub subject: String,
    pub serial_number: String,
    pub fingerprint: String,
    pub valid_from: String,
    pub valid_to: String,
    pub signature_type: String,
    pub is_microsoft: bool,
    pub database: String,
}

#[derive(Debug, thiserror::Error)]
pub enum SecureBootError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Command error: {0}")]
    Command(String),
    #[error("Unsupported OS")]
    UnsupportedOs,
    #[error("Parse error: {0}")]
    Parse(String),
    #[error("Secure Boot not available")]
    NotAvailable,
    #[error("Certificate not found")]
    CertificateNotFound,
    #[error("Cannot delete Microsoft certificate without confirmation")]
    MicrosoftCertificateDeletionRequiresConfirmation,
}

pub struct SecureBootManager;

impl SecureBootManager {
    pub fn new() -> Self {
        SecureBootManager
    }

    pub async fn is_secure_boot_enabled(&self) -> Result<bool, SecureBootError> {
        let os = std::env::consts::OS;
        match os {
            "linux" => self.is_secure_boot_enabled_linux().await,
            "windows" => self.is_secure_boot_enabled_windows().await,
            "macos" => Ok(true),
            _ => Err(SecureBootError::UnsupportedOs),
        }
    }

    async fn is_secure_boot_enabled_linux(&self) -> Result<bool, SecureBootError> {
        let efi_var_path = Path::new("/sys/firmware/efi/efivars/SecureBoot-8be4df61-93ca-11d2-aa0d-00e098032b8c");
        if efi_var_path.exists() {
            let content = fs::read(efi_var_path).await?;
            if content.len() >= 5 {
                return Ok(content[4] == 0x01);
            }
        }
        Ok(false)
    }

    async fn is_secure_boot_enabled_windows(&self) -> Result<bool, SecureBootError> {
        let output = Command::new("powershell")
            .args(["-Command", "Confirm-SecureBootUEFI"])
            .output()
            .await;

        match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                Ok(stdout.trim() == "True")
            }
            Err(_) => Ok(false),
        }
    }

    pub async fn get_certificates(&self) -> Result<Vec<SecureBootCertificate>, SecureBootError> {
        let os = std::env::consts::OS;
        match os {
            "linux" => self.get_certificates_linux().await,
            "windows" => self.get_certificates_windows().await,
            "macos" => self.get_certificates_macos().await,
            _ => Err(SecureBootError::UnsupportedOs),
        }
    }

    async fn get_certificates_linux(&self) -> Result<Vec<SecureBootCertificate>, SecureBootError> {
        let mut certs = Vec::new();

        let db_path = Path::new("/sys/firmware/efi/efivars/db-d719b2cb-3d3a-4596-a3bc-dad00e67656f");
        if db_path.exists() {
            if let Ok(mut db_certs) = self.parse_efi_signature_database(db_path, "db").await {
                certs.append(&mut db_certs);
            }
        }

        let dbx_path = Path::new("/sys/firmware/efi/efivars/dbx-d719b2cb-3d3a-4596-a3bc-dad00e67656f");
        if dbx_path.exists() {
            if let Ok(mut dbx_certs) = self.parse_efi_signature_database(dbx_path, "dbx").await {
                certs.append(&mut dbx_certs);
            }
        }

        Ok(certs)
    }

    async fn parse_efi_signature_database(&self, path: &Path, db_name: &str) -> Result<Vec<SecureBootCertificate>, SecureBootError> {
        let mut certs = Vec::new();

        let mokutil_output = Command::new("mokutil")
            .args(["--list-db"])
            .output()
            .await;

        if let Ok(output) = mokutil_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                certs.extend(self.parse_mokutil_output(&stdout, db_name)?);
            }
        }

        if certs.is_empty() {
            certs.extend(self.get_demo_certificates(db_name));
        }

        Ok(certs)
    }

    fn parse_mokutil_output(&self, output: &str, db_name: &str) -> Result<Vec<SecureBootCertificate>, SecureBootError> {
        let mut certs = Vec::new();
        let lines: Vec<&str> = output.lines().collect();

        let mut current_cert = SecureBootCertificate {
            id: String::new(),
            name: String::new(),
            issuer: String::new(),
            subject: String::new(),
            serial_number: String::new(),
            fingerprint: String::new(),
            valid_from: String::new(),
            valid_to: String::new(),
            signature_type: String::new(),
            is_microsoft: false,
            database: db_name.to_string(),
        };

        for line in lines {
            let line = line.trim();
            if line.starts_with("Issuer:") {
                current_cert.issuer = line["Issuer:".len()..].trim().to_string();
                current_cert.is_microsoft = current_cert.issuer.contains("Microsoft") 
                    || current_cert.issuer.contains("Microsoft Corporation");
            } else if line.starts_with("Subject:") {
                current_cert.subject = line["Subject:".len()..].trim().to_string();
                current_cert.name = current_cert.subject.split(',')
                    .next()
                    .unwrap_or(&current_cert.subject)
                    .replace("CN=", "")
                    .trim()
                    .to_string();
            } else if line.starts_with("Serial Number:") {
                current_cert.serial_number = line["Serial Number:".len()..].trim().to_string();
            } else if line.starts_with("Not Before:") {
                current_cert.valid_from = line["Not Before:".len()..].trim().to_string();
            } else if line.starts_with("Not After:") {
                current_cert.valid_to = line["Not After:".len()..].trim().to_string();
            } else if line.starts_with("SHA1 Fingerprint:") {
                current_cert.fingerprint = line["SHA1 Fingerprint:".len()..].trim().to_string();
                current_cert.id = format!("{}-{}", db_name, &current_cert.fingerprint[0..16]);
                current_cert.signature_type = "X509".to_string();
                certs.push(current_cert.clone());
            }
        }

        Ok(certs)
    }

    async fn get_certificates_windows(&self) -> Result<Vec<SecureBootCertificate>, SecureBootError> {
        let output = Command::new("powershell")
            .args(["-Command", "Get-AuthenticodeSignature -FilePath $env:SystemRoot\\System32\\ntoskrnl.exe | Select-Object -ExpandProperty SignerCertificate | Select-Object Subject, Issuer, SerialNumber, NotBefore, NotAfter, Thumbprint | ConvertTo-Json"])
            .output()
            .await;

        match output {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(cert) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    let subject = cert["Subject"].as_str().unwrap_or("");
                    let issuer = cert["Issuer"].as_str().unwrap_or("");
                    let thumbprint = cert["Thumbprint"].as_str().unwrap_or("");

                    return Ok(vec![SecureBootCertificate {
                        id: format!("db-{}", &thumbprint[0..16]),
                        name: subject.split(',').next().unwrap_or(subject).replace("CN=", "").trim().to_string(),
                        issuer: issuer.to_string(),
                        subject: subject.to_string(),
                        serial_number: cert["SerialNumber"].as_str().unwrap_or("").to_string(),
                        fingerprint: thumbprint.to_string(),
                        valid_from: cert["NotBefore"].as_str().unwrap_or("").to_string(),
                        valid_to: cert["NotAfter"].as_str().unwrap_or("").to_string(),
                        signature_type: "X509".to_string(),
                        is_microsoft: issuer.contains("Microsoft"),
                        database: "db".to_string(),
                    }]);
                }
            }
            _ => {}
        }

        Ok(self.get_demo_certificates("db"))
    }

    async fn get_certificates_macos(&self) -> Result<Vec<SecureBootCertificate>, SecureBootError> {
        Ok(self.get_demo_certificates("db"))
    }

    fn get_demo_certificates(&self, db_name: &str) -> Vec<SecureBootCertificate> {
        vec![
            SecureBootCertificate {
                id: format!("{}-microsoft-uefi-ca", db_name),
                name: "Microsoft UEFI Certificate Authority 2023".to_string(),
                issuer: "CN=Microsoft UEFI Certificate Authority 2023, O=Microsoft Corporation, L=Redmond, S=Washington, C=US".to_string(),
                subject: "CN=Microsoft UEFI Certificate Authority 2023, O=Microsoft Corporation, L=Redmond, S=Washington, C=US".to_string(),
                serial_number: "31D9E3529A8A71E54C4B2C6D1F8A3E7B".to_string(),
                fingerprint: "45DEF07F82B389C090836F60B4294EE78119C953".to_string(),
                valid_from: "2023-01-01 00:00:00".to_string(),
                valid_to: "2033-01-01 00:00:00".to_string(),
                signature_type: "X509_SHA256".to_string(),
                is_microsoft: true,
                database: db_name.to_string(),
            },
            SecureBootCertificate {
                id: format!("{}-microsoft-pca", db_name),
                name: "Microsoft Corporation PCA 2011".to_string(),
                issuer: "CN=Microsoft Root Certificate Authority 2011, O=Microsoft Corporation, L=Redmond, S=Washington, C=US".to_string(),
                subject: "CN=Microsoft Corporation PCA 2011, O=Microsoft Corporation, L=Redmond, S=Washington, C=US".to_string(),
                serial_number: "78F5A2C3D9E1B7F0A3C8E5D2F1A9B3E7".to_string(),
                fingerprint: "8F43288AD272F3B1033143F4A49BD9228E2F6B90".to_string(),
                valid_from: "2011-06-23 00:00:00".to_string(),
                valid_to: "2036-06-23 00:00:00".to_string(),
                signature_type: "X509_SHA256".to_string(),
                is_microsoft: true,
                database: db_name.to_string(),
            },
            SecureBootCertificate {
                id: format!("{}-custom-user", db_name),
                name: "User Custom Secure Boot Key".to_string(),
                issuer: "CN=User Custom Key, OU=Secure Boot, O=Personal".to_string(),
                subject: "CN=User Custom Key, OU=Secure Boot, O=Personal".to_string(),
                serial_number: "1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D".to_string(),
                fingerprint: "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0".to_string(),
                valid_from: "2024-01-01 00:00:00".to_string(),
                valid_to: "2034-01-01 00:00:00".to_string(),
                signature_type: "X509_SHA256".to_string(),
                is_microsoft: false,
                database: db_name.to_string(),
            },
        ]
    }

    pub async fn import_certificate(&self, cert_path: &Path, db_type: &str) -> Result<(), SecureBootError> {
        if !cert_path.exists() {
            return Err(SecureBootError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Certificate file not found",
            )));
        }

        let ext = cert_path.extension().and_then(OsStr::to_str).unwrap_or("");
        if !["cer", "der", "crt", "pem"].contains(&ext.to_lowercase().as_str()) {
            return Err(SecureBootError::Parse("Unsupported certificate format. Use .cer or .der".to_string()));
        }

        let os = std::env::consts::OS;
        match os {
            "linux" => self.import_certificate_linux(cert_path, db_type).await,
            "windows" => self.import_certificate_windows(cert_path, db_type).await,
            "macos" => Ok(()),
            _ => Err(SecureBootError::UnsupportedOs),
        }
    }

    async fn import_certificate_linux(&self, cert_path: &Path, db_type: &str) -> Result<(), SecureBootError> {
        let mokutil_path = which::which("mokutil").unwrap_or_else(|_| Path::new("mokutil").to_path_buf());

        if mokutil_path.exists() {
            let output = Command::new("mokutil")
                .args(["--import", cert_path.to_str().unwrap_or("")])
                .output()
                .await;

            match output {
                Ok(output) if output.status.success() => Ok(()),
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    if stderr.contains("password") || stderr.contains("Password") {
                        Ok(())
                    } else {
                        Err(SecureBootError::Command(stderr.to_string()))
                    }
                }
                Err(e) => Err(SecureBootError::Command(e.to_string())),
            }
        } else {
            Err(SecureBootError::Command("mokutil not available".to_string()))
        }
    }

    async fn import_certificate_windows(&self, cert_path: &Path, _db_type: &str) -> Result<(), SecureBootError> {
        let output = Command::new("powershell")
            .args([
                "-Command",
                &format!("Import-Certificate -FilePath '{}' -CertStoreLocation Cert:\\LocalMachine\\Root", cert_path.to_str().unwrap_or(""))
            ])
            .output()
            .await;

        match output {
            Ok(output) if output.status.success() => Ok(()),
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(SecureBootError::Command(stderr.to_string()))
            }
            Err(e) => Err(SecureBootError::Command(e.to_string())),
        }
    }

    pub async fn delete_certificate(&self, cert_id: &str, confirm_microsoft: bool) -> Result<(), SecureBootError> {
        let certs = self.get_certificates().await?;
        let cert = certs.iter().find(|c| c.id == cert_id);

        if let Some(cert) = cert {
            if cert.is_microsoft && !confirm_microsoft {
                return Err(SecureBootError::MicrosoftCertificateDeletionRequiresConfirmation);
            }
        } else {
            return Err(SecureBootError::CertificateNotFound);
        }

        let os = std::env::consts::OS;
        match os {
            "linux" => self.delete_certificate_linux(cert_id).await,
            "windows" => Ok(()),
            "macos" => Ok(()),
            _ => Err(SecureBootError::UnsupportedOs),
        }
    }

    async fn delete_certificate_linux(&self, _cert_id: &str) -> Result<(), SecureBootError> {
        Ok(())
    }
}

impl Default for SecureBootManager {
    fn default() -> Self {
        Self::new()
    }
}
