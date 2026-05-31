package com.scheduler.shard;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * 归并函数接口 - 用于将多个分片的执行结果汇总
 * 实现类必须是可序列化的
 */
public interface MergeFunction extends Serializable {

    /**
     * 归并函数名称
     */
    String getName();

    /**
     * 执行归并逻辑
     * @param shardResults 所有分片的执行结果列表
     * @param params 自定义参数
     * @return 归并后的最终结果
     */
    Object merge(List<ShardResult> shardResults, Map<String, Object> params);

    /**
     * 分片执行结果
     */
    class ShardResult implements Serializable {
        private String shardId;
        private String shardKey;
        private Object result;
        private boolean success;
        private String error;

        public ShardResult() {}

        public ShardResult(String shardId, String shardKey, Object result, boolean success, String error) {
            this.shardId = shardId;
            this.shardKey = shardKey;
            this.result = result;
            this.success = success;
            this.error = error;
        }

        public String getShardId() { return shardId; }
        public void setShardId(String shardId) { this.shardId = shardId; }
        public String getShardKey() { return shardKey; }
        public void setShardKey(String shardKey) { this.shardKey = shardKey; }
        public Object getResult() { return result; }
        public void setResult(Object result) { this.result = result; }
        public boolean isSuccess() { return success; }
        public void setSuccess(boolean success) { this.success = success; }
        public String getError() { return error; }
        public void setError(String error) { this.error = error; }
    }
}
