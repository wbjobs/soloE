package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.configcenter.model.ConfigItem;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.http.client.fluent.Request;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

@Slf4j
@Service
@RequiredArgsConstructor
public class ClusterSyncService {

    private final ConfigService configService;
    private final ObjectMapper objectMapper;
    private final ConfigCenterProperties properties;

    @Value("${config.cluster.sync.enabled:true}")
    private boolean syncEnabled;

    @Value("${config.cluster.sync.interval:30000}")
    private long syncInterval;

    @Value("${config.cluster.self-url:http://localhost:8888}")
    private String selfUrl;

    @Value("${config.cluster.peer-nodes:}")
    private String peerNodes;

    private final List<String> peers = new ArrayList<>();
    private final Map<String, LocalDateTime> lastSyncTimes = new ConcurrentHashMap<>();
    private final AtomicBoolean syncing = new AtomicBoolean(false);

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SyncStatus {
        private String nodeUrl;
        private boolean connected;
        private LocalDateTime lastSyncTime;
        private int syncedConfigs;
        private String status;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SyncResult {
        private boolean success;
        private int syncedCount;
        private int failedCount;
        private String message;
    }

    @PostConstruct
    public void init() {
        if (!syncEnabled) {
            log.info("Cluster sync is disabled");
            return;
        }

        if (peerNodes != null && !peerNodes.isEmpty()) {
            String[] nodes = peerNodes.split(",");
            for (String node : nodes) {
                String trimmed = node.trim();
                if (!trimmed.isEmpty() && !trimmed.equals(selfUrl)) {
                    peers.add(trimmed);
                }
            }
        }

        log.info("Cluster sync initialized with {} peer nodes: {}", peers.size(), peers);
    }

    @Scheduled(fixedDelayString = "${config.cluster.sync.interval:30000}")
    public void scheduledSync() {
        if (!syncEnabled || peers.isEmpty()) {
            return;
        }

        if (!syncing.compareAndSet(false, true)) {
            return;
        }

        try {
            for (String peer : peers) {
                syncFromPeer(peer);
            }
        } finally {
            syncing.set(false);
        }
    }

    public SyncResult syncFromPeer(String peerUrl) {
        try {
            log.info("Syncing from peer: {}", peerUrl);

            String url = peerUrl + "/api/config/cluster/export";
            String response = Request.Get(url)
                    .connectTimeout(5000)
                    .socketTimeout(30000)
                    .execute()
                    .returnContent()
                    .asString();

            JsonNode root = objectMapper.readTree(response);
            if (root.get("code").asInt() != 200) {
                return SyncResult.builder()
                        .success(false)
                        .syncedCount(0)
                        .failedCount(0)
                        .message("Peer returned error")
                        .build();
            }

            JsonNode data = root.get("data");
            int synced = 0;
            int failed = 0;

            for (JsonNode configNode : data) {
                try {
                    ConfigItem config = objectMapper.treeToValue(configNode, ConfigItem.class);
                    ConfigItem existing = configService.getConfig(config.getEnv(), config.getAppName(), config.getKey());

                    if (existing == null) {
                        configService.createConfig(config, "cluster-sync");
                        synced++;
                    } else if (!existing.getVersion().equals(config.getVersion())) {
                        configService.updateConfig(config, "cluster-sync");
                        synced++;
                    }
                } catch (Exception e) {
                    failed++;
                    log.error("Sync config failed: {}", e.getMessage());
                }
            }

            lastSyncTimes.put(peerUrl, LocalDateTime.now());

            return SyncResult.builder()
                    .success(true)
                    .syncedCount(synced)
                    .failedCount(failed)
                    .message(String.format("Synced %d configs, %d failed", synced, failed))
                    .build();
        } catch (Exception e) {
            log.error("Sync from peer failed: {}", peerUrl, e);
            return SyncResult.builder()
                    .success(false)
                    .syncedCount(0)
                    .failedCount(0)
                    .message(e.getMessage())
                    .build();
        }
    }

    public List<SyncStatus> getSyncStatus() {
        List<SyncStatus> statusList = new ArrayList<>();

        for (String peer : peers) {
            boolean connected = false;
            try {
                String url = peer + "/api/config/cluster/health";
                String response = Request.Get(url)
                        .connectTimeout(2000)
                        .socketTimeout(5000)
                        .execute()
                        .returnContent()
                        .asString();

                JsonNode root = objectMapper.readTree(response);
                connected = root.get("code").asInt() == 200;
            } catch (Exception e) {
                // ignore
            }

            statusList.add(SyncStatus.builder()
                    .nodeUrl(peer)
                    .connected(connected)
                    .lastSyncTime(lastSyncTimes.get(peer))
                    .status(connected ? "CONNECTED" : "DISCONNECTED")
                    .build());
        }

        return statusList;
    }

    public List<ConfigItem> exportConfigs() {
        List<ConfigItem> allConfigs = new ArrayList<>();
        for (String env : Arrays.asList("dev", "test", "prod")) {
            try {
                String path = properties.getEnvPath(env);
                List<ConfigItem> envConfigs = configService.listConfigs(env, "");
                allConfigs.addAll(envConfigs);
            } catch (Exception e) {
                log.warn("Failed to export configs for env: {}", env);
            }
        }
        return allConfigs;
    }

    public SyncResult syncAll() {
        if (!syncEnabled) {
            return SyncResult.builder()
                    .success(false)
                    .message("Cluster sync is disabled")
                    .build();
        }

        if (peers.isEmpty()) {
            return SyncResult.builder()
                    .success(false)
                    .message("No peer nodes configured")
                    .build();
        }

        int totalSynced = 0;
        int totalFailed = 0;

        for (String peer : peers) {
            SyncResult result = syncFromPeer(peer);
            totalSynced += result.getSyncedCount();
            totalFailed += result.getFailedCount();
        }

        return SyncResult.builder()
                .success(true)
                .syncedCount(totalSynced)
                .failedCount(totalFailed)
                .message(String.format("Sync completed: %d synced, %d failed", totalSynced, totalFailed))
                .build();
    }

    public void addPeerNode(String nodeUrl) {
        if (!peers.contains(nodeUrl) && !nodeUrl.equals(selfUrl)) {
            peers.add(nodeUrl);
            log.info("Added peer node: {}", nodeUrl);
        }
    }

    public void removePeerNode(String nodeUrl) {
        peers.remove(nodeUrl);
        log.info("Removed peer node: {}", nodeUrl);
    }
}
