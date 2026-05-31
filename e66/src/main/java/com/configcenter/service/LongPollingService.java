package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.configcenter.model.ConfigItem;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

@Slf4j
@Service
public class LongPollingService {

    private final ConfigWatchService configWatchService;
    private final ConfigCenterProperties properties;
    private final ObjectMapper objectMapper;
    private final Map<String, CompletableFuture<ConfigItem>> pendingRequests = new ConcurrentHashMap<>();
    private final Map<String, List<SseEmitter>> sseEmitters = new ConcurrentHashMap<>();

    public LongPollingService(ConfigWatchService configWatchService, ConfigCenterProperties properties, ObjectMapper objectMapper) {
        this.configWatchService = configWatchService;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public CompletableFuture<ConfigItem> poll(String env, String appName, String key, long timeoutMs) {
        String requestKey = env + ":" + appName + ":" + key + ":" + System.currentTimeMillis();

        CompletableFuture<ConfigItem> future = new CompletableFuture<>();

        Consumer<ConfigItem> watcher = configItem -> {
            if (configItem.getKey().equals(key) || "GRAY_CHANGE".equals(configItem.getVersion())) {
                if (!future.isDone()) {
                    future.complete(configItem);
                }
            }
        };

        configWatchService.registerWatcher(env, appName, watcher);

        long actualTimeout = timeoutMs > 0 ? timeoutMs : properties.getLongPollTimeout();

        CompletableFuture.delayedExecutor(actualTimeout, TimeUnit.MILLISECONDS).execute(() -> {
            if (!future.isDone()) {
                future.complete(null);
            }
        });

        future.whenComplete((result, ex) -> {
            configWatchService.unregisterWatcher(env, appName, watcher);
            pendingRequests.remove(requestKey);
        });

        pendingRequests.put(requestKey, future);

        return future;
    }

    public CompletableFuture<Map<String, String>> batchPoll(String env, String appName, List<String> keys, long timeoutMs) {
        String requestKey = env + ":" + appName + ":" + keys.hashCode() + ":" + System.currentTimeMillis();

        CompletableFuture<Map<String, String>> future = new CompletableFuture<>();
        Map<String, String> changedConfigs = new ConcurrentHashMap<>();

        Consumer<ConfigItem> watcher = configItem -> {
            if (keys.contains(configItem.getKey()) || "GRAY_CHANGE".equals(configItem.getVersion())) {
                changedConfigs.put(configItem.getKey(), configItem.getValue());
                if (!future.isDone()) {
                    future.complete(changedConfigs);
                }
            }
        };

        configWatchService.registerWatcher(env, appName, watcher);

        long actualTimeout = timeoutMs > 0 ? timeoutMs : properties.getLongPollTimeout();

        CompletableFuture.delayedExecutor(actualTimeout, TimeUnit.MILLISECONDS).execute(() -> {
            if (!future.isDone()) {
                future.complete(changedConfigs.isEmpty() ? null : changedConfigs);
            }
        });

        future.whenComplete((result, ex) -> {
            configWatchService.unregisterWatcher(env, appName, watcher);
            pendingRequests.remove(requestKey);
        });

        pendingRequests.put(requestKey, (CompletableFuture) future);

        return future;
    }

    public SseEmitter sseConnect(String env, String appName, String clientId) {
        SseEmitter emitter = new SseEmitter(0L);

        String emitterKey = env + ":" + appName + ":" + clientId;
        sseEmitters.computeIfAbsent(emitterKey, k -> new CopyOnWriteArrayList<>()).add(emitter);

        Consumer<ConfigItem> watcher = configItem -> {
            try {
                emitter.send(SseEmitter.event()
                        .name("config-change")
                        .id(configItem.getKey())
                        .data(objectMapper.writeValueAsString(configItem)));
            } catch (IOException e) {
                log.debug("SSE send error, client may be disconnected", e);
                emitter.completeWithError(e);
            }
        };

        configWatchService.registerWatcher(env, appName, watcher);

        emitter.onCompletion(() -> {
            configWatchService.unregisterWatcher(env, appName, watcher);
            List<SseEmitter> emitters = sseEmitters.get(emitterKey);
            if (emitters != null) {
                emitters.remove(emitter);
            }
            log.info("SSE connection completed: {}", emitterKey);
        });

        emitter.onTimeout(() -> {
            configWatchService.unregisterWatcher(env, appName, watcher);
            List<SseEmitter> emitters = sseEmitters.get(emitterKey);
            if (emitters != null) {
                emitters.remove(emitter);
            }
            log.info("SSE connection timeout: {}", emitterKey);
        });

        emitter.onError((ex) -> {
            configWatchService.unregisterWatcher(env, appName, watcher);
            List<SseEmitter> emitters = sseEmitters.get(emitterKey);
            if (emitters != null) {
                emitters.remove(emitter);
            }
            log.info("SSE connection error: {}", emitterKey, ex);
        });

        try {
            emitter.send(SseEmitter.event().name("connected").data("SSE connection established"));
        } catch (IOException e) {
            log.error("Failed to send SSE connected event", e);
        }

        log.info("New SSE connection: {}", emitterKey);
        return emitter;
    }

    public int getPendingRequestCount() {
        return pendingRequests.size();
    }

    public int getSseConnectionCount() {
        return sseEmitters.values().stream().mapToInt(List::size).sum();
    }
}
