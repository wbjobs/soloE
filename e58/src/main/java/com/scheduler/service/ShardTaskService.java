package com.scheduler.service;

import com.alibaba.fastjson2.JSON;
import com.scheduler.entity.ShardTask;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskPriority;
import com.scheduler.enums.TaskStatus;
import com.scheduler.enums.TaskType;
import com.scheduler.repository.ShardTaskRepository;
import com.scheduler.repository.TaskInstanceRepository;
import com.scheduler.shard.MergeFunction;
import com.scheduler.shard.ShardFunction;
import com.scheduler.shard.ShardFunctionRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class ShardTaskService {

    private final ShardTaskRepository shardTaskRepository;
    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskQueueService taskQueueService;
    private final ShardFunctionRegistry functionRegistry;

    /**
     * 提交分片任务
     * @param request 分片任务请求
     * @return 父任务ID
     */
    @Transactional
    public String submitShardedTask(ShardedTaskRequest request) {
        log.info("Submitting sharded task: {}, shards: {}", request.getTaskName(), request.getShardCount());

        // 1. 创建父任务
        TaskInstance parentTask = new TaskInstance();
        parentTask.setTaskName(request.getTaskName());
        parentTask.setType(TaskType.SHARD);
        parentTask.setPriority(TaskPriority.valueOf(request.getPriority().toUpperCase()));
        parentTask.setStatus(TaskStatus.SHARDING);
        parentTask.setMaxRetries(request.getMaxRetries());
        parentTask.setRetryCount(0);
        parentTask.setTimeoutMs(request.getTimeoutMs());
        parentTask.setPayload(JSON.toJSONString(Map.of(
                "shardFunction", request.getShardFunction(),
                "mergeFunction", request.getMergeFunction(),
                "shardCount", request.getShardCount(),
                "inputData", request.getInputData(),
                "shardParams", request.getShardParams(),
                "mergeParams", request.getMergeParams()
        )));
        parentTask = taskInstanceRepository.save(parentTask);

        // 2. 执行分片
        ShardFunction shardFunction = functionRegistry.getShardFunction(request.getShardFunction());
        if (shardFunction == null) {
            throw new IllegalArgumentException("Shard function not found: " + request.getShardFunction());
        }

        List<ShardFunction.Shard> shards = shardFunction.shard(
                request.getInputData(),
                request.getShardCount(),
                request.getShardParams()
        );

        log.info("Generated {} shards for task: {}", shards.size(), parentTask.getId());

        // 3. 创建分片任务
        for (int i = 0; i < shards.size(); i++) {
            ShardFunction.Shard shard = shards.get(i);

            ShardTask shardTask = new ShardTask();
            shardTask.setParentTaskId(parentTask.getId());
            shardTask.setShardIndex(i);
            shardTask.setTotalShards(shards.size());
            shardTask.setShardKey(shard.getKey());
            shardTask.setShardData(JSON.toJSONString(shard.getData()));
            shardTask.setStatus("PENDING");
            shardTask = shardTaskRepository.save(shardTask);

            // 4. 提交分片任务到队列
            TaskInstance task = new TaskInstance();
            task.setTaskName(request.getTaskName() + "-shard-" + i);
            task.setType(TaskType.SHELL); // 默认使用SHELL类型执行分片
            task.setPriority(TaskPriority.valueOf(request.getPriority().toUpperCase()));
            task.setStatus(TaskStatus.PENDING);
            task.setPayload(JSON.toJSONString(Map.of(
                    "shardTaskId", shardTask.getId(),
                    "shardIndex", i,
                    "shardKey", shard.getKey(),
                    "shardData", shard.getData(),
                    "parentTaskId", parentTask.getId()
            )));
            task.setMaxRetries(request.getMaxRetries());
            task.setRetryCount(0);
            task.setTimeoutMs(request.getTimeoutMs());
            taskInstanceRepository.save(task);

            taskQueueService.submitTask(task);
        }

        // 5. 更新父任务状态
        parentTask.setStatus(TaskStatus.RUNNING);
        parentTask.setStartedAt(LocalDateTime.now());
        taskInstanceRepository.save(parentTask);

        return parentTask.getId();
    }

    /**
     * 更新分片任务状态
     */
    @Transactional
    public void updateShardTaskStatus(String shardTaskId, String status, String result, String error) {
        shardTaskRepository.findById(shardTaskId).ifPresent(shardTask -> {
            shardTask.setStatus(status);
            shardTask.setResult(result);
            shardTask.setErrorMessage(error);
            if ("COMPLETED".equals(status) || "FAILED".equals(status)) {
                shardTask.setCompletedAt(LocalDateTime.now());
            }
            if ("RUNNING".equals(status)) {
                shardTask.setStartedAt(LocalDateTime.now());
            }
            shardTaskRepository.save(shardTask);
            log.info("Shard task {} status updated to: {}", shardTaskId, status);
        });
    }

    /**
     * 定时监控分片任务完成情况
     */
    @Scheduled(fixedDelay = 5000)
    @Transactional
    public void monitorShardedTasks() {
        List<String> activeParentIds = shardTaskRepository.findActiveParentTaskIds();

        for (String parentId : activeParentIds) {
            checkAndCompleteShardedTask(parentId);
        }
    }

    /**
     * 检查分片任务是否全部完成，并执行归并
     */
    private void checkAndCompleteShardedTask(String parentTaskId) {
        TaskInstance parentTask = taskInstanceRepository.findById(parentTaskId).orElse(null);
        if (parentTask == null) {
            return;
        }

        long totalShards = shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "COMPLETED")
                + shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "FAILED")
                + shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "PENDING")
                + shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "RUNNING");

        long completedShards = shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "COMPLETED");
        long failedShards = shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "FAILED");
        long pendingShards = shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "PENDING");
        long runningShards = shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "RUNNING");

        // 所有分片都已完成或失败
        if (pendingShards == 0 && runningShards == 0) {
            log.info("All shards completed for task {}: completed={}, failed={}",
                    parentTaskId, completedShards, failedShards);

            if (failedShards > 0) {
                parentTask.setStatus(TaskStatus.FAILED);
                parentTask.setErrorMessage("有 " + failedShards + " 个分片执行失败");
            } else {
                executeMerge(parentTask);
                parentTask.setStatus(TaskStatus.COMPLETED);
            }

            parentTask.setCompletedAt(LocalDateTime.now());
            taskInstanceRepository.save(parentTask);
        }
    }

    /**
     * 执行归并操作
     */
    private void executeMerge(TaskInstance parentTask) {
        try {
            Map<String, Object> payload = JSON.parseObject(parentTask.getPayload(), Map.class);
            String mergeFunctionName = (String) payload.get("mergeFunction");
            Map<String, Object> mergeParams = (Map<String, Object>) payload.getOrDefault("mergeParams", new HashMap<>());

            MergeFunction mergeFunction = functionRegistry.getMergeFunction(mergeFunctionName);
            if (mergeFunction == null) {
                log.warn("Merge function not found: {}, using default merge", mergeFunctionName);
                parentTask.setResult(JSON.toJSONString(getDefaultMergeResult(parentTask.getId())));
                return;
            }

            List<ShardTask> shardTasks = shardTaskRepository.findByParentTaskId(parentTask.getId());
            List<MergeFunction.ShardResult> shardResults = new ArrayList<>();

            for (ShardTask shardTask : shardTasks) {
                shardResults.add(new MergeFunction.ShardResult(
                        shardTask.getId(),
                        shardTask.getShardKey(),
                        shardTask.getResult(),
                        "COMPLETED".equals(shardTask.getStatus()),
                        shardTask.getErrorMessage()
                ));
            }

            Object mergedResult = mergeFunction.merge(shardResults, mergeParams);
            parentTask.setResult(JSON.toJSONString(mergedResult));
            log.info("Merge completed for task: {}", parentTask.getId());

        } catch (Exception e) {
            log.error("Merge failed for task: {}", parentTask.getId(), e);
            parentTask.setErrorMessage("归并执行失败: " + e.getMessage());
            parentTask.setStatus(TaskStatus.FAILED);
        }
    }

    /**
     * 默认归并结果
     */
    private Map<String, Object> getDefaultMergeResult(String parentTaskId) {
        List<ShardTask> shardTasks = shardTaskRepository.findByParentTaskId(parentTaskId);
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> shardResults = new ArrayList<>();

        for (ShardTask shard : shardTasks) {
            Map<String, Object> shardResult = new HashMap<>();
            shardResult.put("shardId", shard.getId());
            shardResult.put("shardKey", shard.getShardKey());
            shardResult.put("shardIndex", shard.getShardIndex());
            shardResult.put("result", shard.getResult());
            shardResult.put("status", shard.getStatus());
            shardResults.add(shardResult);
        }

        result.put("totalShards", shardTasks.size());
        result.put("shards", shardResults);
        return result;
    }

    /**
     * 获取分片任务列表
     */
    public List<ShardTask> getShardTasks(String parentTaskId) {
        return shardTaskRepository.findByParentTaskId(parentTaskId);
    }

    /**
     * 获取分片任务状态统计
     */
    public Map<String, Long> getShardTaskStats(String parentTaskId) {
        Map<String, Long> stats = new HashMap<>();
        stats.put("pending", shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "PENDING"));
        stats.put("running", shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "RUNNING"));
        stats.put("completed", shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "COMPLETED"));
        stats.put("failed", shardTaskRepository.countByParentTaskIdAndStatus(parentTaskId, "FAILED"));
        return stats;
    }

    /**
     * 分片任务请求
     */
    @lombok.Data
    public static class ShardedTaskRequest {
        private String taskName;
        private String priority = "MEDIUM";
        private int shardCount = 4;
        private String shardFunction;
        private String mergeFunction;
        private Object inputData;
        private Map<String, Object> shardParams = new HashMap<>();
        private Map<String, Object> mergeParams = new HashMap<>();
        private int maxRetries = 3;
        private long timeoutMs = 300000L;
    }
}
