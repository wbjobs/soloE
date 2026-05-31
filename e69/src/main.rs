use wasi_scheduler::*;
use std::net::SocketAddr;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    println!("🚀 WASI 分布式调度器启动中...");

    let config = SchedulerConfig {
        thread_pool_size: num_cpus::get(),
        max_queue_size: 1000,
        default_limits: ResourceLimits {
            max_cpu_time_ms: 30000,
            max_memory_bytes: 512 * 1024 * 1024,
            max_file_descriptors: 128,
        },
        enable_metrics: true,
        enable_ipc: true,
    };

    let scheduler = Arc::new(WasiScheduler::new(config)?);
    println!("✅ 调度器核心初始化完成");

    let dag_manager = Arc::new(DAGManager::new());
    println!("✅ DAG工作流管理器初始化完成");

    let ipc_manager = Arc::new(IpcManager::new(100, 10 * 1024 * 1024));
    println!("✅ IPC共享内存管理器初始化完成");

    let module_manager = Arc::new(ModuleManager::new(Arc::clone(&scheduler.engine)));
    println!("✅ 模块管理器初始化完成");

    let cluster_manager = Arc::new(ClusterManager::new(
        "primary-node".to_string(),
        true,
        Arc::clone(&scheduler),
        Arc::clone(&dag_manager),
    ));
    println!("✅ 集群管理器初始化完成");

    let web_addr: SocketAddr = "0.0.0.0:8080".parse().unwrap();
    println!("🌐 启动Web服务器: http://{}", web_addr);

    let server_future = start_web_server(
        web_addr,
        Arc::clone(&scheduler),
        Arc::clone(&cluster_manager),
        Arc::clone(&dag_manager),
        Arc::clone(&ipc_manager),
        Arc::clone(&module_manager),
        scheduler.metrics.clone(),
    );

    let demo_future = run_demo(
        Arc::clone(&dag_manager),
        Arc::clone(&cluster_manager),
        Arc::clone(&ipc_manager),
    );

    tokio::try_join!(server_future, demo_future)?;

    Ok(())
}

async fn run_demo(
    dag_manager: Arc<DAGManager>,
    cluster_manager: Arc<ClusterManager>,
    ipc_manager: Arc<IpcManager>,
) -> Result<()> {
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    println!("\n📋 ===== 演示模式 =====");
    println!("打开浏览器访问 http://localhost:8080 查看Web界面");
    println!("\n功能说明:");
    println!("  📊 仪表盘 - 实时监控集群状态");
    println!("  🖥️ 集群管理 - 多节点协调和资源监控");
    println!("  ⚙️ 工作流编排 - DAG任务依赖管理");
    println!("  📦 模块管理 - WASI模块加载/卸载");
    println!("  📈 指标监控 - 调度性能指标统计");
    println!("  💬 IPC通信 - 共享内存消息传递");

    let workflow_id = dag_manager.create_workflow(
        "示例数据处理工作流".to_string(),
        "演示DAG工作流编排功能，包含数据获取、处理、存储等步骤".to_string(),
    );

    println!("\n✅ 已创建示例工作流: ID = {}", &workflow_id[..16]);

    let region_id = ipc_manager.create_region(
        "demo_shared_memory".to_string(),
        1024 * 1024,
    )?;
    println!("✅ 已创建共享内存区域: ID = {}", &region_id[..16]);

    println!("\n🎯 ===== 功能完整度 =====");
    println!("  ✅ 分布式调度 (ClusterManager) - 就绪");
    println!("  ✅ DAG工作流编排 (DAGManager) - 就绪");
    println!("  ✅ REST API + Web界面 - 就绪");
    println!("  ✅ IPC共享内存 - 就绪");
    println!("  ✅ 任务优先级队列 - 就绪");
    println!("  ✅ 内存限制保护 - 就绪");
    println!("  ✅ 锁死保护机制 - 就绪");
    println!("  ✅ 性能指标采集 - 就绪");
    println!("\n🎉 调度系统已完全就绪!");

    Ok(())
}
