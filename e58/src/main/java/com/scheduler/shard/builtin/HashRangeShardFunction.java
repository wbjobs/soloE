package com.scheduler.shard.builtin;

import com.scheduler.shard.ShardFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 基于Hash范围的分片函数
 * 将输入数据按ID哈希值分配到不同分片
 */
@Slf4j
@Component
public class HashRangeShardFunction implements ShardFunction {

    @Override
    public String getName() {
        return "HASH_RANGE";
    }

    @Override
    public List<Shard> shard(Object input, int shardCount, Map<String, Object> params) {
        List<Shard> shards = new ArrayList<>();

        if (input instanceof List) {
            List<?> items = (List<?>) input;
            List<List<Object>> shardData = new ArrayList<>();
            for (int i = 0; i < shardCount; i++) {
                shardData.add(new ArrayList<>());
            }

            for (Object item : items) {
                int hash = Math.abs(item.hashCode() % shardCount);
                shardData.get(hash).add(item);
            }

            for (int i = 0; i < shardCount; i++) {
                shards.add(new Shard("shard-" + i, shardData.get(i)));
            }

            log.info("Hash分片完成: {} 条数据分为 {} 个分片", items.size(), shardCount);
        } else {
            for (int i = 0; i < shardCount; i++) {
                shards.add(new Shard("shard-" + i, Map.of("shardIndex", i, "data", input)));
            }
        }

        return shards;
    }
}
