package com.scheduler.service;

import com.scheduler.entity.TaskInstance;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class TaskCompletionListener {

    private final ApplicationEventPublisher eventPublisher;

    public void publishTaskCompleted(TaskInstance task) {
        if (task.getDagId() != null) {
            eventPublisher.publishEvent(new TaskCompletedEvent(task));
        }
    }

    public static class TaskCompletedEvent {
        private final TaskInstance task;

        public TaskCompletedEvent(TaskInstance task) {
            this.task = task;
        }

        public TaskInstance getTask() {
            return task;
        }
    }
}
