package com.scheduler.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "scheduler")
public class SchedulerProperties {

    private WorkerProperties worker = new WorkerProperties();
    private QueueProperties queue = new QueueProperties();
    private RetryProperties retry = new RetryProperties();
    private PriorityProperties priority = new PriorityProperties();

    @Data
    public static class WorkerProperties {
        private String id;
        private long heartbeatInterval = 5000;
        private long taskTimeout = 300000;
        private int maxConcurrentTasks = 5;
    }

    @Data
    public static class QueueProperties {
        private String streamKey = "task_stream";
        private String consumerGroup = "worker_group";
        private long pollTimeout = 2000;
    }

    @Data
    public static class RetryProperties {
        private int maxAttempts = 5;
        private long initialDelay = 1000;
        private double multiplier = 2.0;
        private long maxDelay = 60000;
    }

    @Data
    public static class PriorityProperties {
        private boolean preemptionEnabled = true;
    }
}
