package com.scheduler.service;

import com.alibaba.fastjson2.JSON;
import com.scheduler.config.SchedulerProperties;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskStatus;
import com.scheduler.repository.TaskInstanceRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class TaskQueueService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final SchedulerProperties schedulerProperties;
    private final TaskInstanceRepository taskInstanceRepository;

    private StreamOperations<String, String, Object> streamOperations;

    @PostConstruct
    public void init() {
        streamOperations = redisTemplate.opsForStream();
        createConsumerGroupIfNotExists();
    }

    private void createConsumerGroupIfNotExists() {
        try {
            String streamKey = schedulerProperties.getQueue().getStreamKey();
            String groupName = schedulerProperties.getQueue().getConsumerGroup();

            var records = streamOperations.range(streamKey, Range.unbounded());
            if (records.isEmpty()) {
                Map<String, Object> emptyRecord = new HashMap<>();
                emptyRecord.put("init", "true");
                streamOperations.add(streamKey, emptyRecord);
            }

            streamOperations.createGroup(streamKey, groupName);
            log.info("Created consumer group: {}", groupName);
        } catch (Exception e) {
            log.info("Consumer group already exists: {}", e.getMessage());
        }
    }

    public RecordId submitTask(TaskInstance task) {
        String streamKey = schedulerProperties.getQueue().getStreamKey();

        Map<String, Object> recordMap = new HashMap<>();
        recordMap.put("taskId", task.getId());
        recordMap.put("taskName", task.getTaskName());
        recordMap.put("type", task.getType().name());
        recordMap.put("priority", task.getPriority().name());
        recordMap.put("priorityValue", task.getPriority().getValue());
        recordMap.put("payload", task.getPayload());
        recordMap.put("dagId", task.getDagId() != null ? task.getDagId() : "");

        RecordId recordId = streamOperations.add(streamKey, recordMap);
        log.info("Task submitted to queue: {}, recordId: {}", task.getId(), recordId);

        task.setStatus(TaskStatus.QUEUED);
        taskInstanceRepository.save(task);

        return recordId;
    }

    public List<MapRecord<String, String, Object>> pollTasks(String consumerName, int count) {
        String streamKey = schedulerProperties.getQueue().getStreamKey();
        String groupName = schedulerProperties.getQueue().getConsumerGroup();
        long pollTimeout = schedulerProperties.getQueue().getPollTimeout();

        Consumer consumer = Consumer.from(groupName, consumerName);
        StreamReadOptions options = StreamReadOptions.empty()
                .count(count)
                .block(Duration.ofMillis(pollTimeout));

        StreamOffset<String> streamOffset = StreamOffset.create(streamKey, ReadOffset.lastConsumed());

        List<MapRecord<String, String, Object>> records = streamOperations.read(consumer, options, streamOffset);

        if (records != null && !records.isEmpty()) {
            log.debug("Polled {} tasks from queue for consumer: {}", records.size(), consumerName);
        }

        return records;
    }

    public void acknowledgeTask(RecordId recordId) {
        String streamKey = schedulerProperties.getQueue().getStreamKey();
        String groupName = schedulerProperties.getQueue().getConsumerGroup();

        streamOperations.acknowledge(streamKey, groupName, recordId);
        log.debug("Acknowledged task: {}", recordId);
    }

    public void deleteTask(RecordId recordId) {
        String streamKey = schedulerProperties.getQueue().getStreamKey();
        streamOperations.delete(streamKey, recordId);
    }

    public long getPendingTaskCount() {
        String streamKey = schedulerProperties.getQueue().getStreamKey();
        String groupName = schedulerProperties.getQueue().getConsumerGroup();

        PendingMessagesSummary pending = streamOperations.pending(streamKey, groupName);
        return pending != null ? pending.getTotalPendingMessages() : 0;
    }
}
