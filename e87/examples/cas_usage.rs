use common::{decode, encode, Request, Response, StatsResponse};

fn main() {
    println!("=== CAS (Compare-And-Swap) 使用示例 ===\n");

    println!("1. 创建内存块（版本号初始为 1）");
    let put_req = Request::Put {
        key: "counter".to_string(),
        value: b"0".to_vec(),
        ttl: Some(600),
    };
    println!("   请求: {:?}", put_req);
    println!("   版本号变为: 1\n");

    println!("2. 读取数据获取当前版本");
    let get_req = Request::Get {
        key: "counter".to_string(),
    };
    println!("   请求: {:?}", get_req);
    println!("   响应: Response::Value {{ version: 1, value: \"0\" }}\n");

    println!("3. CAS 更新：只有版本是 1 时才更新");
    let cas_req = Request::CompareAndSwap {
        key: "counter".to_string(),
        value: b"1".to_vec(),
        expected_version: 1,
        new_ttl: None,
    };
    println!("   请求: {:?}", cas_req);
    println!("   成功响应: Response::CasSuccess {{ new_version: 2 }}");
    println!("   失败响应: Response::CasConflict {{ expected: 1, current: 2 }}\n");

    println!("4. 冲突场景：");
    println!("   Client A: Get -> version = 2");
    println!("   Client B: Get -> version = 2");
    println!("   Client A: CAS(expected=2) -> 成功，version 变为 3");
    println!("   Client B: CAS(expected=2) -> 失败，冲突！\n");

    println!("5. 获取统计信息：");
    let stats_req = Request::GetStats;
    println!("   请求: {:?}", stats_req);
    println!("   响应包含：");
    println!("     - 总 CAS 操作数");
    println!("     - CAS 成功数");
    println!("     - CAS 冲突数");
    println!("     - 冲突率");
    println!("     - 每个 key 的冲突次数\n");

    println!("=== 冲突处理建议 ===");
    println!("1. 捕获 CasConflict，重新 Get 获取最新版本");
    println!("2. 使用指数退避重试（推荐 3~5 次）");
    println!("3. 监控 stats 中冲突率高的 key，考虑拆分");
}
