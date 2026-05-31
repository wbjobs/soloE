package com.scheduler.shard.builtin;

import com.scheduler.shard.MergeFunction;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 列表合并归并函数
 * 将所有分片的列表结果合并为一个大列表
 */
@Slf4j
@Component
public class ListMergeFunction implements MergeFunction {

    @Override
    public String getName() {
        return "LIST_MERGE";
    }

    @Override
    public Object merge(List<ShardResult> shardResults, Map<String, Object> params) {
        Map<String, Object> result = new HashMap<>();
        List<Object> mergedList = new ArrayList<>();
        long successCount = 0;
        long failedCount = 0;

        for (ShardResult shardResult : shardResults) {
            if (shardResult.isSuccess()) {
                successCount++;
                Object value = shardResult.getResult();
                if (value instanceof List) {
                    mergedList.addAll((List<?>) value);
                } else if (value instanceof Map) {
                    Map<?, ?> map = (Map<?, ?>) value;
                    if (map.containsKey("items") && map.get("items") instanceof List) {
                        mergedList.addAll((List<?>) map.get("items"));
                    } else {
                        mergedList.add(value);
                    }
                } else if (value != null) {
                    mergedList.add(value);
                }
            } else {
                failedCount++;
            }
        }

        result.put("items", mergedList);
        result.put("totalCount", mergedList.size());
        result.put("successShards", successCount);
        result.put("failedShards", failedCount);
        result.put("totalShards", shardResults.size());

        log.info("List归并完成: 总条目数 = {}", mergedList.size());
        return result;
    }
}
