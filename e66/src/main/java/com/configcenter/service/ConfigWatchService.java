package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.configcenter.model.ConfigItem;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.etcd.jetcd.ByteSequence;
import io.etcd.jetcd.Client;
import io.etcd.jetcd.Watch;
import io.etcd.jetcd.watch.WatchEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.annotation.PostConstruct;
import javax.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

@Slf4j
@Service
public class ConfigWatchService {

    private final Client etcdClient;
    private final ConfigCenterProperties properties;
    private final ObjectMapper objectMapper;
    private final Map<String, CopyOnWriteArrayList<Consumer<ConfigItem>>> watchers = new ConcurrentHashMap<>();
    private Watch.Watcher watcher;

    public ConfigWatchService(Client etcdClient, ConfigCenterProperties properties, ObjectMapper objectMapper) {
        this.etcdClient = etcdClient;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        startWatch();
    }

    @PreDestroy
    public void destroy() {
        if (watcher != null) {
            watcher.close();
        }
    }

    private void startWatch() {
        try {
            String watchPath = properties.getBasePath();
            watcher = etcdClient.getWatchClient().watch(
                    ByteSequence.from(watchPath, StandardCharsets.UTF_8),
                    io.etcd.jetcd.options.WatchOption.newBuilder().isPrefix(true).build(),
                    response -> {
                        for (WatchEvent event : response.getEvents()) {
                            handleWatchEvent(event);
                        }
                    }
            );
            log.info("Config watch started on path: {}", watchPath);
        } catch (Exception e) {
            log.error("Start config watch error", e);
        }
    }

    private void handleWatchEvent(WatchEvent event) {
        try {
            String key = event.getKeyValue().getKey().toString(StandardCharsets.UTF_8);
            String value = event.getKeyValue().getValue().toString(StandardCharsets.UTF_8);

            log.info("Watch event: type={}, key={}", event.getEventType(), key);

            if (event.getEventType() == WatchEvent.EventType.PUT || event.getEventType() == WatchEvent.EventType.DELETE) {
                if (key.contains("/history/")) {
                    return;
                }

                if (key.contains("/gray/")) {
                    log.info("Gray config changed, notifying all watchers");
                    notifyAllWatchersForGrayChange(key);
                    return;
                }

                if (key.contains("/routes")) {
                    log.info("Route config changed");
                    return;
                }

                ConfigItem configItem = objectMapper.readValue(value, ConfigItem.class);
                notifyWatchers(configItem);
            }
        } catch (Exception e) {
            log.error("Handle watch event error", e);
        }
    }

    private void notifyAllWatchersForGrayChange(String grayKey) {
        try {
            String[] parts = grayKey.split("/");
            if (parts.length >= 5) {
                String env = parts[parts.length - 3];
                String appName = parts[parts.length - 2];
                String configKey = parts[parts.length - 1];

                String watcherKey = env + ":" + appName;
                CopyOnWriteArrayList<Consumer<ConfigItem>> list = watchers.get(watcherKey);
                if (list != null) {
                    ConfigItem dummyConfig = ConfigItem.builder()
                            .key(configKey)
                            .env(env)
                            .appName(appName)
                            .version("GRAY_CHANGE")
                            .build();

                    for (Consumer<ConfigItem> consumer : list) {
                        try {
                            consumer.accept(dummyConfig);
                        } catch (Exception e) {
                            log.error("Notify watcher for gray change error", e);
                        }
                    }
                    log.info("Notified {} watchers for gray config change: {}", list.size(), configKey);
                }
            }
        } catch (Exception e) {
            log.error("Notify all watchers for gray change error", e);
        }
    }

    public void registerWatcher(String env, String appName, Consumer<ConfigItem> consumer) {
        String key = env + ":" + appName;
        watchers.computeIfAbsent(key, k -> new CopyOnWriteArrayList<>()).add(consumer);
        log.info("Watcher registered: env={}, appName={}", env, appName);
    }

    public void unregisterWatcher(String env, String appName, Consumer<ConfigItem> consumer) {
        String key = env + ":" + appName;
        CopyOnWriteArrayList<Consumer<ConfigItem>> list = watchers.get(key);
        if (list != null) {
            list.remove(consumer);
            log.info("Watcher unregistered: env={}, appName={}", env, appName);
        }
    }

    private void notifyWatchers(ConfigItem configItem) {
        String key = configItem.getEnv() + ":" + configItem.getAppName();
        CopyOnWriteArrayList<Consumer<ConfigItem>> list = watchers.get(key);
        if (list != null) {
            for (Consumer<ConfigItem> consumer : list) {
                try {
                    consumer.accept(configItem);
                } catch (Exception e) {
                    log.error("Notify watcher error", e);
                }
            }
        }
    }
}
