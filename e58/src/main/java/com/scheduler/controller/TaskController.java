package com.scheduler.controller;

import com.scheduler.dto.ApiResponse;
import com.scheduler.dto.TaskRequest;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskPriority;
import com.scheduler.enums.TaskStatus;
import com.scheduler.enums.TaskType;
import com.scheduler.repository.TaskInstanceRepository;
import com.scheduler.service.PreemptionService;
import com.scheduler.service.TaskQueueService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@RestController
@RequestMapping("/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskQueueService taskQueueService;
    private final TaskInstanceRepository taskInstanceRepository;
    private final PreemptionService preemptionService;

    @PostMapping
    public ApiResponse<TaskInstance> submitTask(@Valid @RequestBody TaskRequest request) {
        TaskInstance task = new TaskInstance();
        task.setTaskName(request.getTaskName());
        task.setType(TaskType.valueOf(request.getType().toUpperCase()));
        task.setPriority(TaskPriority.valueOf(request.getPriority().toUpperCase()));
        task.setPayload(request.getPayload());
        task.setStatus(TaskStatus.PENDING);
        task.setMaxRetries(request.getMaxRetries());
        task.setRetryCount(0);
        task.setTimeoutMs(request.getTimeoutMs() != null ? request.getTimeoutMs() : 300000L);

        taskInstanceRepository.save(task);

        RecordId recordId = taskQueueService.submitTask(task);
        log.info("Task submitted: {}, recordId: {}", task.getId(), recordId);

        return ApiResponse.success("Task submitted successfully", task);
    }

    @GetMapping("/{taskId}")
    public ApiResponse<TaskInstance> getTaskStatus(@PathVariable String taskId) {
        Optional<TaskInstance> task = taskInstanceRepository.findById(taskId);
        return task.map(taskInstance -> ApiResponse.success(taskInstance))
                .orElse(ApiResponse.error("Task not found"));
    }

    @GetMapping
    public ApiResponse<List<TaskInstance>> getAllTasks() {
        return ApiResponse.success(taskInstanceRepository.findAll());
    }

    @GetMapping("/status/{status}")
    public ApiResponse<List<TaskInstance>> getTasksByStatus(@PathVariable String status) {
        List<TaskInstance> tasks = taskInstanceRepository.findByStatus(TaskStatus.valueOf(status.toUpperCase()));
        return ApiResponse.success(tasks);
    }

    @PostMapping("/{taskId}/preempt")
    public ApiResponse<Boolean> preemptTask(@PathVariable String taskId) {
        boolean success = preemptionService.preemptTask(taskId);
        if (success) {
            return ApiResponse.success("Task preempted successfully", true);
        }
        return ApiResponse.error("Failed to preempt task or task not running");
    }

    @GetMapping("/queue/pending")
    public ApiResponse<Map<String, Long>> getPendingTaskCount() {
        long count = taskQueueService.getPendingTaskCount();
        return ApiResponse.success(Map.of("pendingTasks", count));
    }
}
