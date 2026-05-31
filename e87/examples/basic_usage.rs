use common::{decode, encode, Request, Response};
use quinn::{ClientConfig, Endpoint};
use rustls::{Certificate, ClientConfig as TlsClientConfig, RootCertStore};
use rustls_pemfile::certs;
use std::net::SocketAddr;
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let server_addr: SocketAddr = "127.0.0.1:8080".parse()?;

    let mut root_store = RootCertStore::empty();
    let certs = certs(&mut std::io::BufReader::new(std::fs::File::open(
        "certs/cert.pem",
    )?))?;
    for cert in certs {
        root_store.add(&Certificate(cert))?;
    }

    let mut tls_config = TlsClientConfig::builder()
        .with_safe_defaults()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = vec![b"quic-mem-coord/1.0".to_vec()];

    let client_config = ClientConfig::new(Arc::new(tls_config));
    let mut endpoint = Endpoint::client("0.0.0.0:0".parse()?)?;
    endpoint.set_default_client_config(client_config);

    let conn = endpoint.connect(server_addr, "localhost")?.await?;
    println!("Connected to server");

    let send_request = |req: &Request| async {
        let data = encode(req)?;
        let (mut send, mut recv) = conn.open_bi().await?;
        send.write_all(&data).await?;
        send.finish().await?;
        let mut buf = Vec::new();
        while let Some(chunk) = recv.read_chunk(usize::MAX, true).await? {
            buf.extend_from_slice(&chunk.bytes);
        }
        let resp = decode::<Response>(&buf)?;
        Ok::<Response, anyhow::Error>(resp)
    };

    let resp = send_request(&Request::Register {
        node_id: "test-node".to_string(),
        address: "127.0.0.1:9000".to_string(),
    })
    .await?;
    println!("Register response: {:?}", resp);

    let resp = send_request(&Request::Put {
        key: "hello".to_string(),
        value: b"world".to_vec(),
        ttl: Some(300),
    })
    .await?;
    println!("Put response: {:?}", resp);

    let resp = send_request(&Request::Get {
        key: "hello".to_string(),
    })
    .await?;
    println!("Get response: {:?}", resp);

    let resp = send_request(&Request::ListKeys).await?;
    println!("List response: {:?}", resp);

    conn.close(0u32.into(), b"done");
    endpoint.wait_idle().await;

    Ok(())
}
