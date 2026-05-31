package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.configcenter.model.ConfigHistory;
import com.configcenter.model.ConfigItem;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.base.Strings;
import io.etcd.jetcd.ByteSequence;
import io.etcd.jetcd.Client;
import io.etcd.jetcd.KeyValue;
import io.etcd.jetcd.kv.GetResponse;
import io.etcd.jetcd.options.GetOption;
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
public class ConfigService {

    private final Client etcdClient;
    private final ConfigCenterProperties properties;
    private final ObjectMapper objectMapper;
    private final EncryptionService encryptionService;

    public ConfigItem getConfig(String env, String appName, String key) {
        try {
            String path = properties.getConfigPath(env, appName, key);
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(ByteSequence.from(path, StandardCharsets.UTF_8));
            GetResponse response = future.get();
            if (response.getKvs().isEmpty()) {
                return null;
            }
            KeyValue kv = response.getKvs().get(0);
            ConfigItem item = objectMapper.readValue(kv.getValue().getBytes(), ConfigItem.class);
            if (item.isEncrypted() && item.getValue() != null) {
                item.setDecryptedValue(encryptionService.decrypt(item.getValue()));
            }
            return item;
        } catch (Exception e) {
            log.error("Get config error: env={}, appName={}, key={}", env, appName, key, e);
            throw new RuntimeException("获取配置失败", e);
        }
    }

    public List<ConfigItem> listConfigs(String env, String appName) {
        try {
            String path = properties.getAppPath(env, appName);
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).build()
            );
            GetResponse response = future.get();
            List<ConfigItem> items = new ArrayList<>();
            for (KeyValue kv : response.getKvs()) {
                ConfigItem item = objectMapper.readValue(kv.getValue().getBytes(), ConfigItem.class);
                if (item.isEncrypted() && item.getValue() != null) {
                    item.setDecryptedValue(encryptionService.decrypt(item.getValue()));
                }
                items.add(item);
            }
            return items;
        } catch (Exception e) {
            log.error("List configs error: env={}, appName={}", env, appName, e);
            throw new RuntimeException("获取配置列表失败", e);
        }
    }

    public ConfigItem createConfig(ConfigItem config, String operator) {
        try {
            config.setVersion(generateVersion());
            config.setCreatedAt(LocalDateTime.now());
            config.setUpdatedAt(LocalDateTime.now());
            config.setCreatedBy(operator);
            config.setUpdatedBy(operator);

            if (Boolean.TRUE.equals(config.getEncrypted()) && config.getValue() != null) {
                config.setValue(encryptionService.encrypt(config.getValue()));
            }

            String path = properties.getConfigPath(config.getEnv(), config.getAppName(), config.getKey());
            byte[] value = objectMapper.writeValueAsBytes(config);

            etcdClient.getKVClient().put(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            saveHistory(config, "CREATE", operator, null);

            auditLogService.log("CREATE", operator, config.getEnv(), config.getAppName(), config.getKey(), config.getValue(), null, null);

            return config;
        } catch (Exception e) {
            log.error("Create config error: key={}", config.getKey(), e);
            throw new RuntimeException("创建配置失败", e);
        }
    }

    public ConfigItem updateConfig(ConfigItem config, String operator) {
        try {
            ConfigItem oldConfig = getConfig(config.getEnv(), config.getAppName(), config.getKey());
            if (oldConfig == null) {
                throw new RuntimeException("配置不存在");
            }

            String oldValue = oldConfig.getValue();

            config.setVersion(generateVersion());
            config.setCreatedAt(oldConfig.getCreatedAt());
            config.setCreatedBy(oldConfig.getCreatedBy());
            config.setUpdatedAt(LocalDateTime.now());
            config.setUpdatedBy(operator);

            if (Boolean.TRUE.equals(config.getEncrypted()) && config.getValue() != null) {
                config.setValue(encryptionService.encrypt(config.getValue()));
            }

            String path = properties.getConfigPath(config.getEnv(), config.getAppName(), config.getKey());
            byte[] value = objectMapper.writeValueAsBytes(config);

            etcdClient.getKVClient().put(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            saveHistory(config, "UPDATE", operator, oldValue);

            auditLogService.log("UPDATE", operator, config.getEnv(), config.getAppName(), config.getKey(), config.getValue(), oldValue, null);

            return config;
        } catch (Exception e) {
            log.error("Update config error: key={}", config.getKey(), e);
            throw new RuntimeException("更新配置失败", e);
        }
    }

    public void deleteConfig(String env, String appName, String key, String operator) {
        try {
            ConfigItem oldConfig = getConfig(env, appName, key);
            if (oldConfig == null) {
                return;
            }

            String path = properties.getConfigPath(env, appName, key);
            etcdClient.getKVClient().delete(ByteSequence.from(path, StandardCharsets.UTF_8)).get();

            ConfigHistory history = ConfigHistory.builder()
                    .key(key)
                    .env(env)
                    .appName(appName)
                    .value(oldConfig.getValue())
                    .version(oldConfig.getVersion())
                    .operation("DELETE")
                    .operator(operator)
                    .timestamp(LocalDateTime.now())
                    .build();

            saveHistoryToEtcd(history);
        } catch (Exception e) {
            log.error("Delete config error: env={}, appName={}, key={}", env, appName, key, e);
            throw new RuntimeException("删除配置失败", e);
        }
    }

    public List<ConfigHistory> getConfigHistory(String env, String appName, String key) {
        try {
            String path = properties.getHistoryPath(env, appName, key);
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).withLimit(properties.getHistoryLimit()).withSortField(GetOption.SortTarget.MOD).withSortOrder(GetOption.SortOrder.DESCEND).build()
            );
            GetResponse response = future.get();
            List<ConfigHistory> histories = new ArrayList<>();
            for (KeyValue kv : response.getKvs()) {
                ConfigHistory history = objectMapper.readValue(kv.getValue().getBytes(), ConfigHistory.class);
                histories.add(history);
            }
            return histories.stream()
                    .sorted((a, b) -> {
                        int timeCompare = b.getTimestamp().compareTo(a.getTimestamp());
                        if (timeCompare != 0) {
                            return timeCompare;
                        }
                        return b.getVersion().compareTo(a.getVersion());
                    })
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Get config history error: env={}, appName={}, key={}", env, appName, key, e);
            throw new RuntimeException("获取历史记录失败", e);
        }
    }

    public ConfigItem rollbackConfig(String env, String appName, String key, String targetVersion, String operator) {
        try {
            List<ConfigHistory> histories = getConfigHistory(env, appName, key);
            ConfigHistory targetHistory = histories.stream()
                    .filter(h -> h.getVersion().equals(targetVersion))
                    .findFirst()
                    .orElseThrow(() -> new RuntimeException("目标版本不存在"));

            ConfigItem currentConfig = getConfig(env, appName, key);
            if (currentConfig == null) {
                throw new RuntimeException("当前配置不存在");
            }

            String rollbackVersion = generateVersion();

            ConfigItem config = ConfigItem.builder()
                    .key(key)
                    .value(targetHistory.getValue())
                    .env(env)
                    .appName(appName)
                    .description(currentConfig.getDescription())
                    .version(rollbackVersion)
                    .createdAt(currentConfig.getCreatedAt())
                    .createdBy(currentConfig.getCreatedBy())
                    .updatedAt(java.time.LocalDateTime.now())
                    .updatedBy(operator)
                    .build();

            String path = properties.getConfigPath(env, appName, key);
            byte[] value = objectMapper.writeValueAsBytes(config);
            etcdClient.getKVClient().put(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            ConfigHistory rollbackHistory = ConfigHistory.builder()
                    .key(key)
                    .env(env)
                    .appName(appName)
                    .value(targetHistory.getValue())
                    .version(rollbackVersion)
                    .operation("ROLLBACK")
                    .operator(operator)
                    .previousValue(currentConfig.getValue())
                    .timestamp(java.time.LocalDateTime.now())
                    .build();

            saveHistoryToEtcd(rollbackHistory);

            log.info("Config rolled back: key={}, fromVersion={}, toVersion={}", key, currentConfig.getVersion(), rollbackVersion);

            return config;
        } catch (Exception e) {
            log.error("Rollback config error: env={}, appName={}, key={}, version={}", env, appName, key, targetVersion, e);
            throw new RuntimeException("回滚配置失败", e);
        }
    }

    private void saveHistory(ConfigItem config, String operation, String operator, String previousValue) {
        ConfigHistory history = ConfigHistory.builder()
                .key(config.getKey())
                .env(config.getEnv())
                .appName(config.getAppName())
                .value(config.getValue())
                .version(config.getVersion())
                .operation(operation)
                .operator(operator)
                .previousValue(previousValue)
                .timestamp(LocalDateTime.now())
                .build();

        saveHistoryToEtcd(history);
    }

    private void saveHistoryToEtcd(ConfigHistory history) {
        try {
            String historyKey = String.format("%s/%s_%s",
                    properties.getHistoryPath(history.getEnv(), history.getAppName(), history.getKey()),
                    history.getTimestamp().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmssSSS")),
                    history.getVersion());

            byte[] value = objectMapper.writeValueAsBytes(history);
            etcdClient.getKVClient().put(
                    ByteSequence.from(historyKey, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();
        } catch (Exception e) {
            log.error("Save history error: key={}", history.getKey(), e);
        }
    }

    private String generateVersion() {
        return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + "_" +
                UUID.randomUUID().toString().substring(0, 8);
    }

    public String getConfigValueForClient(String env, String appName, String key, String clientIp, String clientTags) {
        try {
            ConfigItem config = getConfig(env, appName, key);
            if (config == null) {
                return null;
            }

            GrayConfigService.GrayMatchResult grayResult = grayConfigService.matchGrayConfig(env, appName, key, clientIp, clientTags);
            if (grayResult.isMatched()) {
                log.info("Gray config matched: key={}, ip={}, tags={}", key, clientIp, clientTags);
                return grayResult.getGrayValue();
            }

            return config.getValue();
        } catch (Exception e) {
            log.error("Get config value for client error", e);
            return null;
        }
    }

    @org.springframework.beans.factory.annotation.Autowired
    @org.springframework.context.annotation.Lazy
    private GrayConfigService grayConfigService;
}
