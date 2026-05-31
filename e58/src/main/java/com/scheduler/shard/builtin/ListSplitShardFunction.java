package com.scheduler.shard.builtin;

import com.scheduler.shard.ShardFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 列表分割分片函数
 * 将输入列表平均分割到多个分片
 */
@Slf4j
@Component
public class ListSplitShardFunction implements ShardFunction {

    @Override
    public String getName() {
        return "LIST_SPLIT";
    }

    @Override
    public List<Shard> shard(Object input, int shardCount, Map<String, Object> params) {
        List<Shard> shards = new ArrayList<>();

        if (input instanceof List) {
            List<?> items = (List<?>) input;
            int total = items.size();
            int perShard = (int) Math.ceil((double) total / shardCount);

            for (int i = 0; i < shardCount; i++) {
                int start = i * perShard;
                int end = Math.min(start + perShard, total);

                if (start < total) {
                    List<?> subList = items.subList(start, end);
                    shards.add(new Shard("shard-" + i, subList));
                } else {
                    shards.add(new Shard("shard-" + i, new ArrayList<>()));
                }
            }

            log.info("列表分片完成: {} 条数据分为 {} 个分片，每个分片约 {} 条",
                    total, shardCount, perShard);
        } else {
            for (int i = 0; i < shardCount; i++) {
                shards.add(new Shard("shard-" + i, Map.of("shardIndex", i, "data", input)));
            }
        }

        return shards;
    }
}
