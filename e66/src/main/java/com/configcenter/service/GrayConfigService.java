package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.configcenter.model.GrayConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.etcd.jetcd.ByteSequence;
import io.etcd.jetcd.Client;
import io.etcd.jetcd.KeyValue;
import io.etcd.jetcd.kv.GetResponse;
import io.etcd.jetcd.options.GetOption;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.CompletableFuture;

@Slf4j
@Service
@RequiredArgsConstructor
public class GrayConfigService {

    private final Client etcdClient;
    private final ConfigCenterProperties properties;
    private final ObjectMapper objectMapper;
    private final Random random = new Random();

    @Data
    @AllArgsConstructor
    public static class GrayMatchResult {
        private boolean matched;
        private String grayValue;
    }

    public GrayConfig createGrayConfig(GrayConfig grayConfig) {
        try {
            String path = properties.getGrayPath(grayConfig.getEnv(), grayConfig.getAppName(), grayConfig.getKey());
            byte[] value = objectMapper.writeValueAsBytes(grayConfig);

            etcdClient.getKVClient().put(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            return grayConfig;
        } catch (Exception e) {
            log.error("Create gray config error", e);
            throw new RuntimeException("创建灰度配置失败", e);
        }
    }

    public GrayConfig getGrayConfig(String env, String appName, String key) {
        try {
            String path = properties.getGrayPath(env, appName, key);
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(ByteSequence.from(path, StandardCharsets.UTF_8));
            GetResponse response = future.get();
            if (response.getKvs().isEmpty()) {
                return null;
            }
            KeyValue kv = response.getKvs().get(0);
            return objectMapper.readValue(kv.getValue().getBytes(), GrayConfig.class);
        } catch (Exception e) {
            log.error("Get gray config error", e);
            return null;
        }
    }

    public List<GrayConfig> listGrayConfigs(String env, String appName) {
        try {
            String path = String.format("%s/gray/%s/%s", properties.getBasePath(), env, appName);
            CompletableFuture<GetResponse> future = etcdClient.getKVClient().get(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).build()
            );
            GetResponse response = future.get();
            List<GrayConfig> configs = new ArrayList<>();
            for (KeyValue kv : response.getKvs()) {
                GrayConfig config = objectMapper.readValue(kv.getValue().getBytes(), GrayConfig.class);
                configs.add(config);
            }
            return configs;
        } catch (Exception e) {
            log.error("List gray configs error", e);
            return new ArrayList<>();
        }
    }

    public void deleteGrayConfig(String env, String appName, String key) {
        try {
            String path = properties.getGrayPath(env, appName, key);
            etcdClient.getKVClient().delete(ByteSequence.from(path, StandardCharsets.UTF_8)).get();
        } catch (Exception e) {
            log.error("Delete gray config error", e);
            throw new RuntimeException("删除灰度配置失败", e);
        }
    }

    public GrayMatchResult matchGrayConfig(String env, String appName, String key, String clientIp, String clientTagsJson) {
        try {
            GrayConfig grayConfig = getGrayConfig(env, appName, key);
            if (grayConfig == null || !"ACTIVE".equals(grayConfig.getStatus())) {
                return new GrayMatchResult(false, null);
            }

            LocalDateTime now = LocalDateTime.now();
            if (grayConfig.getStartTime() != null && now.isBefore(grayConfig.getStartTime())) {
                return new GrayMatchResult(false, null);
            }
            if (grayConfig.getEndTime() != null && now.isAfter(grayConfig.getEndTime())) {
                return new GrayMatchResult(false, null);
            }

            if (grayConfig.getTargetIps() != null && !grayConfig.getTargetIps().isEmpty()) {
                if (clientIp != null && grayConfig.getTargetIps().contains(clientIp)) {
                    log.info("Gray config matched by IP: {}", clientIp);
                    return new GrayMatchResult(true, grayConfig.getGrayValue());
                }
            }

            if (grayConfig.getTargetTags() != null && !grayConfig.getTargetTags().isEmpty() && clientTagsJson != null) {
                Map<String, String> clientTags = objectMapper.readValue(clientTagsJson, Map.class);
                boolean tagsMatched = true;
                for (Map.Entry<String, String> entry : grayConfig.getTargetTags().entrySet()) {
                    String clientValue = clientTags.get(entry.getKey());
                    if (clientValue == null || !clientValue.equals(entry.getValue())) {
                        tagsMatched = false;
                        break;
                    }
                }
                if (tagsMatched) {
                    log.info("Gray config matched by tags");
                    return new GrayMatchResult(true, grayConfig.getGrayValue());
                }
            }

            if (grayConfig.getWeight() > 0) {
                int randomValue = random.nextInt(100);
                if (randomValue < grayConfig.getWeight()) {
                    log.info("Gray config matched by weight: {}%", grayConfig.getWeight());
                    return new GrayMatchResult(true, grayConfig.getGrayValue());
                }
            }

            return new GrayMatchResult(false, null);
        } catch (Exception e) {
            log.error("Match gray config error", e);
            return new GrayMatchResult(false, null);
        }
    }
}
