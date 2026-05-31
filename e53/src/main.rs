use light_tsdb::config::Config;
use light_tsdb::downsampling::DownsamplingManager;
use light_tsdb::lsm::LsmTree;
use light_tsdb::promql::Evaluator;
use light_tsdb::server::run_server;
use light_tsdb::ttl::TtlManager;
use clap::Parser;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    let config = Config::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(&config.log_level)),
        )
        .init();

    let data_dir = config.get_data_dir();
    let lsm = Arc::new(LsmTree::new(data_dir).expect("Failed to initialize LSM tree"));

    let downsampling_manager = Arc::new(DownsamplingManager::new(lsm.clone()));

    let evaluator = Arc::new(
        Evaluator::new(lsm.clone())
            .with_downsampling(downsampling_manager.clone()),
    );

    let ttl_manager = TtlManager::new(lsm.clone(), config.retention_days);
    let ttl_handle = tokio::spawn(ttl_manager.run());

    let downsampling_handle = tokio::spawn(downsampling_manager.clone().run());

    let server_handle = tokio::spawn(run_server(
        evaluator,
        lsm,
        downsampling_manager,
        config.host,
        config.port,
    ));

    tokio::select! {
        _ = server_handle => {},
        _ = ttl_handle => {},
        _ = downsampling_handle => {},
    }
}
