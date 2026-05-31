$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path certs | Out-Null

openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem `
  -days 365 -nodes -subj "/CN=localhost" `
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

Write-Host "Certificates generated in certs/"
