package com.scheduler.service;

import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskPriority;
import com.scheduler.enums.TaskStatus;
import com.scheduler.repository.TaskInstanceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class PreemptionService {

    private final TaskInstanceRepository taskInstanceRepository;
    private final TaskExecutionService taskExecutionService;
    private final TaskQueueService taskQueueService;

    public void checkAndPreempt(TaskPriority newTaskPriority) {
        long runningLowPriorityCount = taskInstanceRepository.countRunningTasksWithLowerPriority(newTaskPriority);

        if (runningLowPriorityCount > 0) {
            log.info("Found {} running tasks with lower priority than {}", runningLowPriorityCount, newTaskPriority);
        }
    }

    public boolean preemptLowPriorityTask(String highPriorityTaskId) {
        TaskInstance highPriorityTask = taskInstanceRepository.findById(highPriorityTaskId).orElse(null);
        if (highPriorityTask == null) {
            return false;
        }

        List<TaskInstance> runningTasks = taskInstanceRepository.findByStatus(TaskStatus.RUNNING);

        for (TaskInstance runningTask : runningTasks) {
            if (runningTask.getPriority().getValue() < highPriorityTask.getPriority().getValue()) {
                log.info("Attempting to preempt task: {}, priority: {} for task: {}, priority: {}",
                        runningTask.getId(), runningTask.getPriority(),
                        highPriorityTask.getId(), highPriorityTask.getPriority());

                boolean interrupted = taskExecutionService.interruptTask(runningTask.getId());
                if (interrupted) {
                    runningTask.setRetryCount(runningTask.getRetryCount() + 1);
                    taskInstanceRepository.save(runningTask);
                    taskQueueService.submitTask(runningTask);
                    log.info("Task preempted and requeued: {}", runningTask.getId());
                    return true;
                }
            }
        }

        return false;
    }

    public boolean preemptTask(String taskId) {
        TaskInstance task = taskInstanceRepository.findById(taskId).orElse(null);
        if (task == null || task.getStatus() != TaskStatus.RUNNING) {
            return false;
        }

        boolean interrupted = taskExecutionService.interruptTask(taskId);
        if (interrupted) {
            log.info("Task preempted: {}", taskId);
            return true;
        }

        return false;
    }
}
