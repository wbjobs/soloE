#!/usr/bin/env python3
import argparse
import datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa, ec, ed25519, ed448, padding
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature


def generate_cert(key_file, cert_file, days=365, key_size=2048):
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=key_size,
    )

    with open(key_file, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ))

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Beijing"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Beijing"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Cert Manager"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])

    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        private_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.now(datetime.timezone.utc)
    ).not_valid_after(
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)
    ).add_extension(
        x509.SubjectAlternativeName([x509.DNSName("localhost")]),
        critical=False,
    ).sign(private_key, hashes.SHA256())

    with open(cert_file, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"私钥已保存到: {key_file}")
    print(f"证书已保存到: {cert_file}")


def inspect_cert(cert_file):
    with open(cert_file, "rb") as f:
        cert = x509.load_pem_x509_certificate(f.read())

    print("=" * 60)
    print("证书详细信息")
    print("=" * 60)
    
    print(f"\n序列号: {cert.serial_number}")
    print(f"版本: {cert.version}")
    
    print(f"\n主题:")
    for attr in cert.subject:
        print(f"  {attr.oid._name}: {attr.value}")
    
    print(f"\n颁发者:")
    for attr in cert.issuer:
        print(f"  {attr.oid._name}: {attr.value}")
    
    print(f"\n有效期:")
    print(f"  生效时间: {cert.not_valid_before_utc}")
    print(f"  过期时间: {cert.not_valid_after_utc}")
    
    print(f"\n公钥信息:")
    public_key = cert.public_key()
    
    if isinstance(public_key, rsa.RSAPublicKey):
        print(f"  算法: RSA")
        print(f"  密钥长度: {public_key.key_size} 位")
    elif isinstance(public_key, ec.EllipticCurvePublicKey):
        print(f"  算法: ECDSA")
        print(f"  曲线: {public_key.curve.name}")
        print(f"  密钥长度: {public_key.key_size} 位")
    elif isinstance(public_key, ed25519.Ed25519PublicKey):
        print(f"  算法: Ed25519")
    elif isinstance(public_key, ed448.Ed448PublicKey):
        print(f"  算法: Ed448")
    else:
        print(f"  算法: 未知")
        if hasattr(public_key, 'key_size'):
            print(f"  密钥长度: {public_key.key_size} 位")
    
    print(f"\n签名算法: {cert.signature_algorithm_oid._name}")
    
    print(f"\n扩展信息:")
    for ext in cert.extensions:
        print(f"  {ext.oid._name}: {ext.value}")


def verify_cert(cert_file, ca_cert_file):
    with open(cert_file, "rb") as f:
        cert = x509.load_pem_x509_certificate(f.read())
    
    with open(ca_cert_file, "rb") as f:
        ca_cert = x509.load_pem_x509_certificate(f.read())
    
    print("=" * 60)
    print("证书验证结果")
    print("=" * 60)
    
    print(f"\n待验证证书: {cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value}")
    print(f"CA证书: {ca_cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value}")
    
    issuer_match = cert.issuer == ca_cert.subject
    print(f"\n颁发者匹配: {'✓ 是' if issuer_match else '✗ 否'}")
    
    if not issuer_match:
        print(f"  证书颁发者: {cert.issuer}")
        print(f"  CA主体: {ca_cert.subject}")
    
    now = datetime.datetime.now(datetime.timezone.utc)
    cert_valid = cert.not_valid_before_utc <= now <= cert.not_valid_after_utc
    ca_valid = ca_cert.not_valid_before_utc <= now <= ca_cert.not_valid_after_utc
    
    print(f"\n有效期检查:")
    print(f"  待验证证书: {'✓ 有效' if cert_valid else '✗ 已过期或尚未生效'}")
    print(f"  CA证书: {'✓ 有效' if ca_valid else '✗ 已过期或尚未生效'}")
    
    signature_valid = False
    try:
        ca_public_key = ca_cert.public_key()
        
        if isinstance(ca_public_key, rsa.RSAPublicKey):
            ca_public_key.verify(
                cert.signature,
                cert.tbs_certificate_bytes,
                padding.PKCS1v15(),
                cert.signature_hash_algorithm,
            )
        elif isinstance(ca_public_key, ec.EllipticCurvePublicKey):
            ca_public_key.verify(
                cert.signature,
                cert.tbs_certificate_bytes,
                ec.ECDSA(cert.signature_hash_algorithm),
            )
        elif isinstance(ca_public_key, ed25519.Ed25519PublicKey):
            ca_public_key.verify(
                cert.signature,
                cert.tbs_certificate_bytes,
            )
        elif isinstance(ca_public_key, ed448.Ed448PublicKey):
            ca_public_key.verify(
                cert.signature,
                cert.tbs_certificate_bytes,
            )
        else:
            print(f"\n✗ 不支持的CA公钥算法")
            return False
        
        signature_valid = True
    except InvalidSignature:
        signature_valid = False
    except Exception as e:
        print(f"\n✗ 验证过程出错: {e}")
        return False
    
    print(f"\n签名验证: {'✓ 通过' if signature_valid else '✗ 失败'}")
    
    all_valid = issuer_match and cert_valid and ca_valid and signature_valid
    
    print(f"\n{'=' * 60}")
    if all_valid:
        print("✓ 证书验证成功！该证书由指定CA签发。")
    else:
        print("✗ 证书验证失败！该证书不是由指定CA签发。")
    print("=" * 60)
    
    return all_valid


def main():
    parser = argparse.ArgumentParser(
        description="证书管理工具 - 生成和检查X.509证书",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    subparsers = parser.add_subparsers(dest="command", help="可用命令")
    
    generate_parser = subparsers.add_parser("generate", help="生成自签名RSA私钥和X.509证书")
    generate_parser.add_argument("--key", required=True, help="私钥输出文件路径")
    generate_parser.add_argument("--cert", required=True, help="证书输出文件路径")
    generate_parser.add_argument("--days", type=int, default=365, help="证书有效期（天），默认365")
    generate_parser.add_argument("--key-size", type=int, default=2048, help="RSA密钥长度，默认2048")
    
    inspect_parser = subparsers.add_parser("inspect", help="检查证书文件详细信息")
    inspect_parser.add_argument("--cert", required=True, help="证书文件路径")
    
    verify_parser = subparsers.add_parser("verify", help="验证证书是否由指定CA签发")
    verify_parser.add_argument("--cert", required=True, help="待验证的证书文件路径")
    verify_parser.add_argument("--ca-cert", required=True, help="CA证书文件路径")
    
    args = parser.parse_args()
    
    if args.command == "generate":
        generate_cert(args.key, args.cert, args.days, args.key_size)
    elif args.command == "inspect":
        inspect_cert(args.cert)
    elif args.command == "verify":
        verify_cert(args.cert, args.ca_cert)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
