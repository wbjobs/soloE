package com.scheduler.shard;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

/**
 * 分片函数接口 - 用于将大数据任务分割成多个分片
 * 实现类必须是可序列化的
 */
public interface ShardFunction extends Serializable {

    /**
     * 分片函数名称 - 用于标识和查找分片函数
     */
    String getName();

    /**
     * 执行分片逻辑
     * @param input 输入数据
     * @param shardCount 分片数量
     * @param params 自定义参数
     * @return 分片列表，每个分片包含分片键和分片数据
     */
    List<Shard> shard(Object input, int shardCount, Map<String, Object> params);

    /**
     * 分片数据
     */
    class Shard implements Serializable {
        private String key;
        private Object data;

        public Shard() {}

        public Shard(String key, Object data) {
            this.key = key;
            this.data = data;
        }

        public String getKey() { return key; }
        public void setKey(String key) { this.key = key; }
        public Object getData() { return data; }
        public void setData(Object data) { this.data = data; }
    }
}
