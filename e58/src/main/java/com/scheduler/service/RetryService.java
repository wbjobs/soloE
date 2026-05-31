package com.scheduler.service;

import com.scheduler.config.SchedulerProperties;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskStatus;
import com.scheduler.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RetryService {

    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskQueueService taskQueueService;
    private final SchedulerProperties schedulerProperties;

    @Scheduled(fixedDelay = 10000)
    public void processRetryTasks() {
        LocalDateTime now = LocalDateTime.now();
        List<TaskInstance> retryTasks = taskInstanceRepository.findReadyToRetryTasks(now);

        for (TaskInstance task : retryTasks) {
            if (task.getRetryCount() < task.getMaxRetries()) {
                log.info("Retrying task: {}, attempt: {}", task.getId(), task.getRetryCount() + 1);
                resubmitTask(task);
            } else {
                log.warn("Task reached max retry attempts: {}", task.getId());
                task.setStatus(TaskStatus.FAILED);
                taskInstanceRepository.save(task);
            }
        }
    }

    private void resubmitTask(TaskInstance task) {
        task.setRetryCount(task.getRetryCount() + 1);
        task.setNextRetryAt(calculateNextRetryTime(task.getRetryCount()));
        task.setStatus(TaskStatus.PENDING);
        taskInstanceRepository.save(task);

        taskQueueService.submitTask(task);
    }

    private LocalDateTime calculateNextRetryTime(int retryCount) {
        long initialDelay = schedulerProperties.getRetry().getInitialDelay();
        double multiplier = schedulerProperties.getRetry().getMultiplier();
        long maxDelay = schedulerProperties.getRetry().getMaxDelay();

        long delay = (long) (initialDelay * Math.pow(multiplier, retryCount - 1));
        delay = Math.min(delay, maxDelay);

        return LocalDateTime.now().plusNanos(delay * 1_000_000);
    }

    public void scheduleForRetry(TaskInstance task) {
        task.setStatus(TaskStatus.PENDING);
        task.setNextRetryAt(calculateNextRetryTime(task.getRetryCount() + 1));
        taskInstanceRepository.save(task);
    }
}
