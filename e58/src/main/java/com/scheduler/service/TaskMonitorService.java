package com.scheduler.service;

import com.scheduler.config.SchedulerProperties;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskStatus;
import com.scheduler.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class TaskMonitorService {

    private final TaskInstanceRepository taskInstanceRepository;
    private final RetryService retryService;
    private final SchedulerProperties schedulerProperties;

    /**
     * 定时检测超时任务
     * 每30秒执行一次
     */
    @Scheduled(fixedDelay = 30000)
    @Transactional
    public void detectTimeoutTasks() {
        log.debug("开始检测超时任务...");

        List<TaskInstance> runningTasks = taskInstanceRepository.findByStatus(TaskStatus.RUNNING);
        LocalDateTime now = LocalDateTime.now();

        for (TaskInstance task : runningTasks) {
            if (isTaskTimedOut(task, now)) {
                handleTimeoutTask(task);
            }
        }
    }

    /**
     * 定时回收孤儿任务
     * 每60秒执行一次
     * 孤儿任务：运行中状态，但超过心跳间隔未收到心跳
     */
    @Scheduled(fixedDelay = 60000)
    @Transactional
    public void reclaimOrphanTasks() {
        log.debug("开始回收孤儿任务...");

        long heartbeatInterval = schedulerProperties.getWorker().getHeartbeatInterval();
        long orphanThreshold = heartbeatInterval * 3;

        LocalDateTime thresholdTime = LocalDateTime.now().minusNanos(orphanThreshold * 1_000_000);

        List<TaskInstance> orphanTasks = taskInstanceRepository.findOrphanTasks(thresholdTime);

        for (TaskInstance task : orphanTasks) {
            handleOrphanTask(task);
        }
    }

    private boolean isTaskTimedOut(TaskInstance task, LocalDateTime now) {
        if (task.getStartedAt() == null) {
            return false;
        }

        long timeoutMs = task.getTimeoutMs() != null ? task.getTimeoutMs() : 300000L;
        LocalDateTime timeoutTime = task.getStartedAt().plusNanos(timeoutMs * 1_000_000);

        return now.isAfter(timeoutTime);
    }

    private void handleTimeoutTask(TaskInstance task) {
        log.warn("任务超时，任务ID: {}, 名称: {}, Worker: {}",
                task.getId(), task.getTaskName(), task.getWorkerId());

        task.setStatus(TaskStatus.FAILED);
        task.setCompletedAt(LocalDateTime.now());
        task.setErrorMessage("任务执行超时，超时时间: " + task.getTimeoutMs() + "ms");
        taskInstanceRepository.save(task);

        if (task.getRetryCount() < task.getMaxRetries()) {
            log.info("任务超时，准备重试: {}", task.getId());
            retryService.scheduleForRetry(task);
        } else {
            log.error("任务超时且已达最大重试次数: {}", task.getId());
        }
    }

    private void handleOrphanTask(TaskInstance task) {
        log.warn("检测到孤儿任务，任务ID: {}, 名称: {}, Worker: {}, 最后心跳: {}",
                task.getId(), task.getTaskName(), task.getWorkerId(), task.getLastHeartbeatAt());

        task.setStatus(TaskStatus.FAILED);
        task.setCompletedAt(LocalDateTime.now());
        task.setErrorMessage("任务被判定为孤儿任务，Worker可能已宕机");
        taskInstanceRepository.save(task);

        if (task.getRetryCount() < task.getMaxRetries()) {
            log.info("孤儿任务准备重试: {}", task.getId());
            retryService.scheduleForRetry(task);
        } else {
            log.error("孤儿任务已达最大重试次数: {}", task.getId());
        }
    }

    /**
     * 更新任务心跳时间
     */
    @Transactional
    public void updateTaskHeartbeat(String taskId) {
        taskInstanceRepository.findById(taskId).ifPresent(task -> {
            task.setLastHeartbeatAt(LocalDateTime.now());
            taskInstanceRepository.save(task);
            log.debug("任务心跳更新: {}", taskId);
        });
    }
}
