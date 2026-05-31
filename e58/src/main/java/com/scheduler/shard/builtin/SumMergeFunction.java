package com.scheduler.shard.builtin;

import com.scheduler.shard.MergeFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 求和归并函数
 * 将所有分片的数值结果相加
 */
@Slf4j
@Component
public class SumMergeFunction implements MergeFunction {

    @Override
    public String getName() {
        return "SUM";
    }

    @Override
    public Object merge(List<ShardResult> shardResults, Map<String, Object> params) {
        Map<String, Object> result = new HashMap<>();
        long totalSum = 0;
        long successCount = 0;
        long failedCount = 0;

        for (ShardResult shardResult : shardResults) {
            if (shardResult.isSuccess()) {
                successCount++;
                Object value = shardResult.getResult();
                if (value instanceof Number) {
                    totalSum += ((Number) value).longValue();
                } else if (value instanceof Map) {
                    Map<?, ?> map = (Map<?, ?>) value;
                    if (map.containsKey("count")) {
                        totalSum += ((Number) map.get("count")).longValue();
                    } else if (map.containsKey("sum")) {
                        totalSum += ((Number) map.get("sum")).longValue();
                    }
                }
            } else {
                failedCount++;
            }
        }

        result.put("totalSum", totalSum);
        result.put("successShards", successCount);
        result.put("failedShards", failedCount);
        result.put("totalShards", shardResults.size());

        log.info("Sum归并完成: 总和 = {}", totalSum);
        return result;
    }
}
