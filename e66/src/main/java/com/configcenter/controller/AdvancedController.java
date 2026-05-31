package com.configcenter.controller;

import com.configcenter.model.Result;
import com.configcenter.service.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/config")
public class AdvancedController {

    private final EncryptionService encryptionService;
    private final AuditLogService auditLogService;
    private final ClusterSyncService clusterSyncService;
    private final ConfigValidationService configValidationService;
    private final ConfigTestService configTestService;

    public AdvancedController(EncryptionService encryptionService,
                             AuditLogService auditLogService,
                             ClusterSyncService clusterSyncService,
                             ConfigValidationService configValidationService,
                             ConfigTestService configTestService) {
        this.encryptionService = encryptionService;
        this.auditLogService = auditLogService;
        this.clusterSyncService = clusterSyncService;
        this.configValidationService = configValidationService;
        this.configTestService = configTestService;
    }

    @PostMapping("/encrypt")
    public Result<String> encrypt(@RequestBody Map<String, String> request) {
        String plainText = request.get("plainText");
        String encrypted = encryptionService.encrypt(plainText);
        return Result.success(encrypted);
    }

    @PostMapping("/decrypt")
    public Result<String> decrypt(@RequestBody Map<String, String> request) {
        String encryptedText = request.get("encryptedText");
        String decrypted = encryptionService.decrypt(encryptedText);
        return Result.success(decrypted);
    }

    @GetMapping("/audit")
    public Result<List<AuditLogService.AuditLog>> queryAuditLogs(
            @RequestParam(required = false) String env,
            @RequestParam(required = false) String appName,
            @RequestParam(required = false) String operation,
            @RequestParam(required = false) String startTime,
            @RequestParam(required = false) String endTime) {

        LocalDateTime start = parseDateTime(startTime);
        LocalDateTime end = parseDateTime(endTime);
        List<AuditLogService.AuditLog> logs = auditLogService.queryLogs(env, appName, operation, start, end);
        return Result.success(logs);
    }

    @GetMapping("/audit/count")
    public Result<Map<String, Object>> countAuditLogs(@RequestParam(required = false) String operation) {
        int count = auditLogService.countLogs(operation);
        return Result.success(Map.of("count", count, "operation", operation));
    }

    @GetMapping("/audit/operator/{operator}")
    public Result<List<AuditLogService.AuditLog>> getLogsByOperator(@PathVariable String operator) {
        List<AuditLogService.AuditLog> logs = auditLogService.getLogsByOperator(operator);
        return Result.success(logs);
    }

    @GetMapping("/cluster/health")
    public Result<Map<String, Object>> clusterHealth() {
        return Result.success(Map.of("status", "UP", "timestamp", LocalDateTime.now()));
    }

    @GetMapping("/cluster/sync/status")
    public Result<List<ClusterSyncService.SyncStatus>> getSyncStatus() {
        List<ClusterSyncService.SyncStatus> statusList = clusterSyncService.getSyncStatus();
        return Result.success(statusList);
    }

    @PostMapping("/cluster/sync")
    public Result<ClusterSyncService.SyncResult> triggerSync() {
        ClusterSyncService.SyncResult result = clusterSyncService.syncAll();
        return Result.success(result);
    }

    @GetMapping("/cluster/export")
    public Result<List<com.configcenter.model.ConfigItem>> exportConfigs() {
        List<com.configcenter.model.ConfigItem> configs = clusterSyncService.exportConfigs();
        return Result.success(configs);
    }

    @PostMapping("/cluster/peer/add")
    public Result<Void> addPeerNode(@RequestBody Map<String, String> request) {
        String nodeUrl = request.get("nodeUrl");
        clusterSyncService.addPeerNode(nodeUrl);
        return Result.success();
    }

    @PostMapping("/cluster/peer/remove")
    public Result<Void> removePeerNode(@RequestBody Map<String, String> request) {
        String nodeUrl = request.get("nodeUrl");
        clusterSyncService.removePeerNode(nodeUrl);
        return Result.success();
    }

    @PostMapping("/validate")
    public Result<ConfigValidationService.ValidationResult> validateConfig(
            @RequestBody Map<String, String> request) {
        String content = request.get("content");
        String format = request.get("format");
        ConfigValidationService.ValidationResult result = configValidationService.validate(content, format);
        return Result.success(result);
    }

    @GetMapping("/validate/formats")
    public Result<List<String>> getSupportedFormats() {
        return Result.success(List.of("JSON", "YAML", "PROPERTIES", "AUTO"));
    }

    @PostMapping("/test")
    public Result<ConfigTestService.TestResult> runTests(
            @RequestBody Map<String, Object> request) {
        String env = (String) request.get("env");
        String appName = (String) request.get("appName");
        String key = (String) request.get("key");
        String value = (String) request.get("value");

        ConfigTestService.TestResult result = configTestService.runTests(env, appName, key, value);
        return Result.success(result);
    }

    @GetMapping("/test/available")
    public Result<List<ConfigTestService.TestCase>> getAvailableTests() {
        List<ConfigTestService.TestCase> tests = configTestService.getAvailableTests();
        return Result.success(tests);
    }

    private LocalDateTime parseDateTime(String dateTimeStr) {
        if (dateTimeStr == null || dateTimeStr.isEmpty()) {
            return null;
        }
        try {
            return LocalDateTime.parse(dateTimeStr, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        } catch (Exception e) {
            try {
                return LocalDateTime.parse(dateTimeStr, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            } catch (Exception ex) {
                return null;
            }
        }
    }
}
