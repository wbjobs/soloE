package com.scheduler.controller;

import com.scheduler.dto.ApiResponse;
import com.scheduler.entity.ShardTask;
import com.scheduler.service.ShardFunctionRegistry;
import com.scheduler.service.ShardTaskService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/sharded-tasks")
@RequiredArgsConstructor
public class ShardTaskController {

    private final ShardTaskService shardTaskService;
    private final ShardFunctionRegistry functionRegistry;

    /**
     * 提交分片任务
     */
    @PostMapping
    public ApiResponse<Map<String, String>> submitShardedTask(@Valid @RequestBody ShardTaskService.ShardedTaskRequest request) {
        try {
            String taskId = shardTaskService.submitShardedTask(request);
            return ApiResponse.success("分片任务提交成功", Map.of("taskId", taskId));
        } catch (Exception e) {
            log.error("Failed to submit sharded task", e);
            return ApiResponse.error("提交失败: " + e.getMessage());
        }
    }

    /**
     * 获取分片任务详情
     */
    @GetMapping("/{parentTaskId}/shards")
    public ApiResponse<List<ShardTask>> getShardTasks(@PathVariable String parentTaskId) {
        List<ShardTask> shards = shardTaskService.getShardTasks(parentTaskId);
        return ApiResponse.success(shards);
    }

    /**
     * 获取分片任务状态统计
     */
    @GetMapping("/{parentTaskId}/stats")
    public ApiResponse<Map<String, Long>> getShardTaskStats(@PathVariable String parentTaskId) {
        Map<String, Long> stats = shardTaskService.getShardTaskStats(parentTaskId);
        return ApiResponse.success(stats);
    }

    /**
     * 获取可用的分片函数列表
     */
    @GetMapping("/functions/shard")
    public ApiResponse<List<String>> getShardFunctions() {
        return ApiResponse.success(functionRegistry.getShardFunctionNames());
    }

    /**
     * 获取可用的归并函数列表
     */
    @GetMapping("/functions/merge")
    public ApiResponse<List<String>> getMergeFunctions() {
        return ApiResponse.success(functionRegistry.getMergeFunctionNames());
    }
}
