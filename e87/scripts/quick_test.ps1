$ErrorActionPreference = "Stop"

Write-Host "=== QUIC Memory Coordinator Quick Test ===" -ForegroundColor Green

# 检查 Rust
Write-Host "`n[1/4] Checking Rust installation..."
try {
    rustc --version
    cargo --version
    Write-Host "Rust is installed ✓" -ForegroundColor Green
} catch {
    Write-Host "Rust not found. Please install Rust from https://rustup.rs/" -ForegroundColor Red
    exit 1
}

# 检查 OpenSSL
Write-Host "`n[2/4] Checking OpenSSL..."
try {
    openssl version
    Write-Host "OpenSSL is installed ✓" -ForegroundColor Green
} catch {
    Write-Host "OpenSSL not found. Please install OpenSSL." -ForegroundColor Yellow
}

# 检查项目结构
Write-Host "`n[3/4] Checking project structure..."
$requiredFiles = @(
    "Cargo.toml",
    "common/Cargo.toml",
    "common/src/lib.rs",
    "coordinator/Cargo.toml",
    "coordinator/src/main.rs",
    "client/Cargo.toml",
    "client/src/main.rs",
    "bench/Cargo.toml",
    "bench/src/main.rs"
)

$allPresent = $true
foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file"
    } else {
        Write-Host "  ✗ $file" -ForegroundColor Red
        $allPresent = $false
    }
}

if ($allPresent) {
    Write-Host "All project files present ✓" -ForegroundColor Green
} else {
    Write-Host "Some files are missing!" -ForegroundColor Red
    exit 1
}

# 检查证书
Write-Host "`n[4/4] Checking certificates..."
if ((Test-Path "certs/cert.pem") -and (Test-Path "certs/key.pem")) {
    Write-Host "Certificates found ✓" -ForegroundColor Green
} else {
    Write-Host "Certificates not found. Run: .\scripts\gen_certs.ps1" -ForegroundColor Yellow
}

Write-Host "`n=== Summary ===" -ForegroundColor Green
Write-Host "Project structure is ready."
Write-Host "Next steps:"
Write-Host "  1. Generate certs: .\scripts\gen_certs.ps1"
Write-Host "  2. Build: cargo build --release"
Write-Host "  3. Run coordinator: cargo run --release -p coordinator"
Write-Host "  4. Run benchmark: cargo run --release -p bench"
