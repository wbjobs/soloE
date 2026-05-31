package com.scheduler.service;

import com.scheduler.config.SchedulerProperties;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskStatus;
import com.scheduler.repository.TaskInstanceRepository;
import com.scheduler.task.TaskExecutor;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@Slf4j
@Service
@RequiredArgsConstructor
public class TaskExecutionService {

    private final TaskQueueService taskQueueService;
    private final WorkerRegistryService workerRegistryService;
    private final TaskInstanceRepository taskInstanceRepository;
    private final SchedulerProperties schedulerProperties;
    private final List<TaskExecutor> taskExecutors;
    private final TaskCompletionListener taskCompletionListener;

    private ExecutorService executorService;
    private final Map<String, Future<?>> runningTasks = new ConcurrentHashMap<>();
    private final Map<String, String> runningTaskIds = new ConcurrentHashMap<>();
    private volatile int currentTaskCount = 0;

    @PostConstruct
    public void init() {
        int maxTasks = schedulerProperties.getWorker().getMaxConcurrentTasks();
        executorService = Executors.newFixedThreadPool(maxTasks);
        startTaskPoller();
        startHeartbeatUpdater();
    }

    /**
     * 启动心跳更新线程，定期更新所有运行中任务的心跳时间
     */
    private void startHeartbeatUpdater() {
        Thread heartbeatThread = new Thread(() -> {
            long heartbeatInterval = schedulerProperties.getWorker().getHeartbeatInterval();
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    Thread.sleep(heartbeatInterval);
                    updateAllRunningTasksHeartbeat();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (Exception e) {
                    log.error("Error updating task heartbeats", e);
                }
            }
        }, "task-heartbeat-updater");
        heartbeatThread.setDaemon(true);
        heartbeatThread.start();
        log.info("Task heartbeat updater thread started");
    }

    private void updateAllRunningTasksHeartbeat() {
        LocalDateTime now = LocalDateTime.now();
        for (String taskId : runningTaskIds.keySet()) {
            taskInstanceRepository.findById(taskId).ifPresent(task -> {
                task.setLastHeartbeatAt(now);
                taskInstanceRepository.save(task);
            });
        }
    }

    private void startTaskPoller() {
        Thread pollerThread = new Thread(this::pollTasksLoop, "task-poller");
        pollerThread.setDaemon(true);
        pollerThread.start();
        log.info("Task poller thread started");
    }

    private void pollTasksLoop() {
        String workerId = workerRegistryService.getCurrentWorkerId();
        int maxTasks = schedulerProperties.getWorker().getMaxConcurrentTasks();

        while (!Thread.currentThread().isInterrupted()) {
            try {
                if (currentTaskCount >= maxTasks) {
                    Thread.sleep(1000);
                    continue;
                }

                int availableSlots = maxTasks - currentTaskCount;
                List<MapRecord<String, String, Object>> records = taskQueueService.pollTasks(workerId, availableSlots);

                if (records != null && !records.isEmpty()) {
                    for (MapRecord<String, String, Object> record : records) {
                        processTaskRecord(record, workerId);
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.error("Error in task poller loop", e);
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private void processTaskRecord(MapRecord<String, String, Object> record, String workerId) {
        String taskId = (String) record.getValue().get("taskId");
        String taskType = (String) record.getValue().get("type");

        log.info("Processing task: {}, type: {}", taskId, taskType);

        TaskInstance task = taskInstanceRepository.findById(taskId).orElse(null);
        if (task == null) {
            log.warn("Task not found: {}", taskId);
            taskQueueService.acknowledgeTask(record.getId());
            return;
        }

        task.setStatus(TaskStatus.RUNNING);
        task.setWorkerId(workerId);
        task.setStartedAt(LocalDateTime.now());
        task.setLastHeartbeatAt(LocalDateTime.now());
        taskInstanceRepository.save(task);

        currentTaskCount++;
        workerRegistryService.updateTaskCount(workerId, currentTaskCount);

        Future<?> future = executorService.submit(() -> {
            try {
                executeTask(task, taskType, record.getId());
            } finally {
                currentTaskCount--;
                runningTasks.remove(taskId);
                runningTaskIds.remove(taskId);
                workerRegistryService.updateTaskCount(workerId, currentTaskCount);
            }
        });

        runningTasks.put(taskId, future);
        runningTaskIds.put(taskId, taskId);
    }

    private void executeTask(TaskInstance task, String taskType, RecordId recordId) {
        try {
            TaskExecutor executor = findExecutor(taskType);
            if (executor == null) {
                throw new RuntimeException("No executor found for task type: " + taskType);
            }

            String result = executor.execute(task);

            task.setStatus(TaskStatus.COMPLETED);
            task.setCompletedAt(LocalDateTime.now());
            task.setResult(result);
            taskInstanceRepository.save(task);

            taskCompletionListener.publishTaskCompleted(task);

            taskQueueService.acknowledgeTask(recordId);
            log.info("Task completed successfully: {}", task.getId());

        } catch (Exception e) {
            log.error("Task execution failed: {}", task.getId(), e);

            task.setStatus(TaskStatus.FAILED);
            task.setCompletedAt(LocalDateTime.now());
            task.setErrorMessage(e.getMessage());
            taskInstanceRepository.save(task);

            taskQueueService.acknowledgeTask(recordId);
        }
    }

    private TaskExecutor findExecutor(String type) {
        for (TaskExecutor executor : taskExecutors) {
            if (executor.supports(type)) {
                return executor;
            }
        }
        return null;
    }

    public boolean interruptTask(String taskId) {
        Future<?> future = runningTasks.get(taskId);
        if (future != null && !future.isDone()) {
            boolean cancelled = future.cancel(true);
            if (cancelled) {
                log.info("Task interrupted: {}", taskId);

                taskInstanceRepository.findById(taskId).ifPresent(task -> {
                    task.setStatus(TaskStatus.INTERRUPTED);
                    task.setCompletedAt(LocalDateTime.now());
                    taskInstanceRepository.save(task);
                });

                return true;
            }
        }
        return false;
    }
}
