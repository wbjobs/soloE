package com.configcenter.controller;

import com.configcenter.model.ConfigHistory;
import com.configcenter.model.ConfigItem;
import com.configcenter.model.Result;
import com.configcenter.service.ConfigDiffService;
import com.configcenter.service.ConfigService;
import com.configcenter.service.LongPollingService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;

@Slf4j
@RestController
@RequestMapping("/api/config")
public class ConfigController {

    private final ConfigService configService;
    private final ConfigDiffService configDiffService;
    private final LongPollingService longPollingService;

    public ConfigController(ConfigService configService, ConfigDiffService configDiffService, LongPollingService longPollingService) {
        this.configService = configService;
        this.configDiffService = configDiffService;
        this.longPollingService = longPollingService;
    }

    @GetMapping("/{env}/{appName}/{key}")
    public Result<ConfigItem> getConfig(@PathVariable String env, @PathVariable String appName, @PathVariable String key) {
        ConfigItem config = configService.getConfig(env, appName, key);
        return Result.success(config);
    }

    @GetMapping("/{env}/{appName}")
    public Result<List<ConfigItem>> listConfigs(@PathVariable String env, @PathVariable String appName) {
        List<ConfigItem> configs = configService.listConfigs(env, appName);
        return Result.success(configs);
    }

    @PostMapping
    public Result<ConfigItem> createConfig(@RequestBody ConfigItem config, @RequestParam(defaultValue = "admin") String operator) {
        ConfigItem created = configService.createConfig(config, operator);
        return Result.success(created);
    }

    @PutMapping
    public Result<ConfigItem> updateConfig(@RequestBody ConfigItem config, @RequestParam(defaultValue = "admin") String operator) {
        ConfigItem updated = configService.updateConfig(config, operator);
        return Result.success(updated);
    }

    @DeleteMapping("/{env}/{appName}/{key}")
    public Result<Void> deleteConfig(@PathVariable String env, @PathVariable String appName, @PathVariable String key, @RequestParam(defaultValue = "admin") String operator) {
        configService.deleteConfig(env, appName, key, operator);
        return Result.success();
    }

    @GetMapping("/history/{env}/{appName}/{key}")
    public Result<List<ConfigHistory>> getConfigHistory(@PathVariable String env, @PathVariable String appName, @PathVariable String key) {
        List<ConfigHistory> history = configService.getConfigHistory(env, appName, key);
        return Result.success(history);
    }

    @PostMapping("/rollback/{env}/{appName}/{key}")
    public Result<ConfigItem> rollbackConfig(@PathVariable String env, @PathVariable String appName, @PathVariable String key, @RequestParam String version, @RequestParam(defaultValue = "admin") String operator) {
        ConfigItem rolledBack = configService.rollbackConfig(env, appName, key, version, operator);
        return Result.success(rolledBack);
    }

    @GetMapping("/diff/{env}/{appName}/{key}")
    public Result<ConfigDiffService.DiffResult> compareVersions(@PathVariable String env, @PathVariable String appName, @PathVariable String key, @RequestParam String v1, @RequestParam String v2) {
        List<ConfigHistory> history = configService.getConfigHistory(env, appName, key);
        ConfigHistory h1 = history.stream().filter(h -> h.getVersion().equals(v1)).findFirst().orElse(null);
        ConfigHistory h2 = history.stream().filter(h -> h.getVersion().equals(v2)).findFirst().orElse(null);

        if (h1 == null || h2 == null) {
            return Result.error("版本不存在");
        }

        ConfigHistory older;
        ConfigHistory newer;
        if (h1.getTimestamp().isBefore(h2.getTimestamp())) {
            older = h1;
            newer = h2;
        } else {
            older = h2;
            newer = h1;
        }

        ConfigDiffService.DiffResult diff = configDiffService.compareVersions(older, newer);
        return Result.success(diff);
    }

    @GetMapping("/client/{env}/{appName}/{key}")
    public Result<String> getConfigForClient(@PathVariable String env, @PathVariable String appName, @PathVariable String key, @RequestParam(required = false) String clientIp, @RequestParam(required = false) String clientTags) {
        String value = configService.getConfigValueForClient(env, appName, key, clientIp, clientTags);
        return Result.success(value);
    }

    @GetMapping("/poll/{env}/{appName}/{key}")
    public Result<ConfigItem> pollConfig(@PathVariable String env, @PathVariable String appName, @PathVariable String key, @RequestParam(defaultValue = "0") long timeoutMs) throws ExecutionException, InterruptedException {
        ConfigItem config = longPollingService.poll(env, appName, key, timeoutMs).get();
        return Result.success(config);
    }

    @PostMapping("/poll/batch/{env}/{appName}")
    public Result<Map<String, String>> batchPollConfig(@PathVariable String env, @PathVariable String appName, @RequestBody List<String> keys, @RequestParam(defaultValue = "0") long timeoutMs) throws ExecutionException, InterruptedException {
        Map<String, String> configs = longPollingService.batchPoll(env, appName, keys, timeoutMs).get();
        return Result.success(configs);
    }

    @GetMapping("/sse/{env}/{appName}/{clientId}")
    public SseEmitter sseConnect(@PathVariable String env, @PathVariable String appName, @PathVariable String clientId) {
        return longPollingService.sseConnect(env, appName, clientId);
    }

    @GetMapping("/client/all/{env}/{appName}")
    public Result<Map<String, String>> getAllConfigsForClient(@PathVariable String env, @PathVariable String appName, @RequestParam(required = false) String clientIp, @RequestParam(required = false) String clientTags) {
        List<ConfigItem> configs = configService.listConfigs(env, appName);
        Map<String, String> result = new java.util.HashMap<>();
        for (ConfigItem config : configs) {
            String value = configService.getConfigValueForClient(env, appName, config.getKey(), clientIp, clientTags);
            result.put(config.getKey(), value);
        }
        return Result.success(result);
    }

    @GetMapping("/stats")
    public Result<Map<String, Object>> getStats() {
        Map<String, Object> stats = new java.util.HashMap<>();
        stats.put("pendingRequests", longPollingService.getPendingRequestCount());
        stats.put("sseConnections", longPollingService.getSseConnectionCount());
        return Result.success(stats);
    }
}
