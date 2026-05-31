package com.scheduler.service;

import com.scheduler.config.SchedulerProperties;
import com.scheduler.entity.WorkerNode;
import com.scheduler.enums.WorkerStatus;
import com.scheduler.repository.WorkerNodeRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.InetAddress;
import java.time.LocalDateTime;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class WorkerRegistryService {

    private final WorkerNodeRepository workerNodeRepository;
    private final SchedulerProperties schedulerProperties;

    private String workerId;

    @PostConstruct
    public void registerWorker() {
        try {
            workerId = schedulerProperties.getWorker().getId();
            String hostname = InetAddress.getLocalHost().getHostName();
            String ipAddress = InetAddress.getLocalHost().getHostAddress();

            WorkerNode worker = workerNodeRepository.findById(workerId).orElse(new WorkerNode());
            worker.setId(workerId);
            worker.setHostname(hostname);
            worker.setIpAddress(ipAddress);
            worker.setStatus(WorkerStatus.ONLINE);
            worker.setMaxTasks(schedulerProperties.getWorker().getMaxConcurrentTasks());
            worker.setLastHeartbeatAt(LocalDateTime.now());

            workerNodeRepository.save(worker);
            log.info("Worker registered: {}, hostname: {}, ip: {}", workerId, hostname, ipAddress);
        } catch (Exception e) {
            log.error("Failed to register worker", e);
        }
    }

    @Scheduled(fixedRateString = "${scheduler.worker.heartbeat-interval:5000}")
    public void sendHeartbeat() {
        try {
            workerNodeRepository.findById(workerId).ifPresent(worker -> {
                worker.setLastHeartbeatAt(LocalDateTime.now());
                workerNodeRepository.save(worker);
                log.debug("Heartbeat sent for worker: {}", workerId);
            });
        } catch (Exception e) {
            log.error("Failed to send heartbeat", e);
        }
    }

    @PreDestroy
    public void unregisterWorker() {
        workerNodeRepository.findById(workerId).ifPresent(worker -> {
            worker.setStatus(WorkerStatus.OFFLINE);
            workerNodeRepository.save(worker);
            log.info("Worker unregistered: {}", workerId);
        });
    }

    @Scheduled(fixedRate = 30000)
    public void cleanupDeadWorkers() {
        LocalDateTime timeout = LocalDateTime.now().minusSeconds(30);
        List<WorkerNode> deadWorkers = workerNodeRepository.findUnresponsiveWorkers(timeout);

        for (WorkerNode worker : deadWorkers) {
            worker.setStatus(WorkerStatus.OFFLINE);
            workerNodeRepository.save(worker);
            log.warn("Marked dead worker as offline: {}", worker.getId());
        }
    }

    public void updateTaskCount(String workerId, int taskCount) {
        workerNodeRepository.findById(workerId).ifPresent(worker -> {
            worker.setCurrentTasks(taskCount);
            if (taskCount >= worker.getMaxTasks()) {
                worker.setStatus(WorkerStatus.BUSY);
            } else {
                worker.setStatus(WorkerStatus.ONLINE);
            }
            workerNodeRepository.save(worker);
        });
    }

    public String getCurrentWorkerId() {
        return workerId;
    }

    public List<WorkerNode> getAllWorkers() {
        return workerNodeRepository.findAll();
    }
}
