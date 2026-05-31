package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.etcd.jetcd.ByteSequence;
import io.etcd.jetcd.Client;
import io.etcd.jetcd.KeyValue;
import io.etcd.jetcd.kv.GetResponse;
import io.etcd.jetcd.options.GetOption;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuditLogService {

    private final Client etcdClient;
    private final ConfigCenterProperties properties;
    private final ObjectMapper objectMapper;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AuditLog {
        private String id;
        private String operation;
        private String operator;
        private String env;
        private String appName;
        private String key;
        private String newValue;
        private String oldValue;
        private String clientIp;
        private LocalDateTime timestamp;
        private String details;
    }

    public void log(String operation, String operator, String env, String appName, String key, String newValue, String oldValue, String details) {
        try {
            AuditLog auditLog = AuditLog.builder()
                    .id(UUID.randomUUID().toString())
                    .operation(operation)
                    .operator(operator)
                    .env(env)
                    .appName(appName)
                    .key(key)
                    .newValue(newValue)
                    .oldValue(oldValue)
                    .timestamp(LocalDateTime.now())
                    .details(details)
                    .build();

            String logKey = String.format("%s/audit/%s/%s_%s",
                    properties.getBasePath(),
                    auditLog.getTimestamp().format(DateTimeFormatter.ofPattern("yyyy/MM/dd")),
                    auditLog.getTimestamp().format(DateTimeFormatter.ofPattern("HHmmssSSS")),
                    auditLog.getId().substring(0, 8));

            byte[] value = objectMapper.writeValueAsBytes(auditLog);
            etcdClient.getKVClient().put(
                    ByteSequence.from(logKey, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            log.info("Audit log: {} {} {} {} {}", operation, operator, env, appName, key);
        } catch (Exception e) {
            log.error("Save audit log error", e);
        }
    }

    public List<AuditLog> queryLogs(String env, String appName, String operation, LocalDateTime startTime, LocalDateTime endTime) {
        try {
            String basePath = String.format("%s/audit", properties.getBasePath());
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(
                    ByteSequence.from(basePath, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).withSortField(GetOption.SortTarget.MOD).withSortOrder(GetOption.SortOrder.DESCEND).build()
            );

            GetResponse response = future.get();
            List<AuditLog> logs = new ArrayList<>();

            for (KeyValue kv : response.getKvs()) {
                AuditLog auditLog = objectMapper.readValue(kv.getValue().getBytes(), AuditLog.class);

                if (env != null && !env.equals(auditLog.getEnv())) {
                    continue;
                }
                if (appName != null && !appName.equals(auditLog.getAppName())) {
                    continue;
                }
                if (operation != null && !operation.equals(auditLog.getOperation())) {
                    continue;
                }
                if (startTime != null && auditLog.getTimestamp().isBefore(startTime)) {
                    continue;
                }
                if (endTime != null && auditLog.getTimestamp().isAfter(endTime)) {
                    continue;
                }

                logs.add(auditLog);
            }

            return logs.stream()
                    .sorted((a, b) -> b.getTimestamp().compareTo(a.getTimestamp()))
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Query audit logs error", e);
            return new ArrayList<>();
        }
    }

    public List<AuditLog> getLogsByOperator(String operator) {
        try {
            String basePath = String.format("%s/audit", properties.getBasePath());
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(
                    ByteSequence.from(basePath, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).build()
            );

            GetResponse response = future.get();
            List<AuditLog> logs = new ArrayList<>();

            for (KeyValue kv : response.getKvs()) {
                AuditLog auditLog = objectMapper.readValue(kv.getValue().getBytes(), AuditLog.class);
                if (operator.equals(auditLog.getOperator())) {
                    logs.add(auditLog);
                }
            }

            return logs.stream()
                    .sorted((a, b) -> b.getTimestamp().compareTo(a.getTimestamp()))
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Get logs by operator error", e);
            return new ArrayList<>();
        }
    }

    public int countLogs(String operation) {
        try {
            String basePath = String.format("%s/audit", properties.getBasePath());
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(
                    ByteSequence.from(basePath, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).build()
            );

            GetResponse response = future.get();
            if (operation == null) {
                return response.getKvs().size();
            }

            int count = 0;
            for (KeyValue kv : response.getKvs()) {
                AuditLog auditLog = objectMapper.readValue(kv.getValue().getBytes(), AuditLog.class);
                if (operation.equals(auditLog.getOperation())) {
                    count++;
                }
            }
            return count;
        } catch (Exception e) {
            log.error("Count logs error", e);
            return 0;
        }
    }
}
