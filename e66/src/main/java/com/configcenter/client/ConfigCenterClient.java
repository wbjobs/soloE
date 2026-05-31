package com.configcenter.client;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.http.client.fluent.Request;
import org.apache.http.client.fluent.Response;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

@Slf4j
public class ConfigCenterClient {

    private final String baseUrl;
    private final String env;
    private final String appName;
    private final String clientIp;
    private final String clientTags;
    private final String clientId;
    private final ObjectMapper objectMapper;
    private final ScheduledExecutorService scheduler;
    private final ExecutorService sseExecutor;
    private final Map<String, String> configCache = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<Consumer<Map<String, String>>> listeners = new CopyOnWriteArrayList<>();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private ScheduledFuture<?> pollFuture;
    private Future<?> sseFuture;
    private boolean useSse = true;

    public ConfigCenterClient(String baseUrl, String env, String appName) {
        this(baseUrl, env, appName, null, null);
    }

    public ConfigCenterClient(String baseUrl, String env, String appName, String clientIp, String clientTags) {
        this.baseUrl = baseUrl;
        this.env = env;
        this.appName = appName;
        this.clientIp = clientIp;
        this.clientTags = clientTags;
        this.clientId = UUID.randomUUID().toString();
        this.objectMapper = new ObjectMapper();
        this.scheduler = Executors.newScheduledThreadPool(2);
        this.sseExecutor = Executors.newSingleThreadExecutor();
    }

    public void setUseSse(boolean useSse) {
        this.useSse = useSse;
    }

    public void start() {
        if (!running.compareAndSet(false, true)) {
            log.warn("Client already started");
            return;
        }

        loadAllConfigs();

        if (useSse) {
            startSseConnection();
        } else {
            startBatchLongPolling();
        }

        log.info("ConfigCenterClient started: env={}, appName={}, clientId={}", env, appName, clientId);
    }

    public void stop() {
        if (!running.compareAndSet(true, false)) {
            return;
        }

        if (pollFuture != null) {
            pollFuture.cancel(true);
        }
        if (sseFuture != null) {
            sseFuture.cancel(true);
        }

        scheduler.shutdown();
        sseExecutor.shutdown();

        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
            if (!sseExecutor.awaitTermination(5, TimeUnit.SECONDS)) {
                sseExecutor.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            sseExecutor.shutdownNow();
        }

        log.info("ConfigCenterClient stopped");
    }

    public String getConfig(String key) {
        return configCache.get(key);
    }

    public String getConfig(String key, String defaultValue) {
        return configCache.getOrDefault(key, defaultValue);
    }

    public Map<String, String> getAllConfigs() {
        return new java.util.HashMap<>(configCache);
    }

    public void addConfigChangeListener(Consumer<Map<String, String>> listener) {
        listeners.add(listener);
    }

    public void removeConfigChangeListener(Consumer<Map<String, String>> listener) {
        listeners.remove(listener);
    }

    private void loadAllConfigs() {
        try {
            String url = String.format("%s/api/config/client/all/%s/%s?clientIp=%s&clientTags=%s",
                    baseUrl, env, appName,
                    clientIp != null ? clientIp : "",
                    clientTags != null ? clientTags : "");

            String response = Request.Get(url)
                    .connectTimeout(5000)
                    .socketTimeout(30000)
                    .execute()
                    .returnContent()
                    .asString();

            JsonNode root = objectMapper.readTree(response);
            if (root.get("code").asInt() == 200) {
                Map<String, String> configs = objectMapper.convertValue(root.get("data"), new TypeReference<Map<String, String>>() {});
                configCache.putAll(configs);
                log.info("Loaded {} configs from config center", configs.size());
            }
        } catch (IOException e) {
            log.error("Failed to load configs from config center", e);
        }
    }

    private void startBatchLongPolling() {
        pollFuture = scheduler.scheduleWithFixedDelay(() -> {
            if (!running.get()) {
                return;
            }

            try {
                List<String> keys = List.copyOf(configCache.keySet());
                if (keys.isEmpty()) {
                    TimeUnit.SECONDS.sleep(5);
                    return;
                }

                String url = String.format("%s/api/config/poll/batch/%s/%s?timeoutMs=55000&clientIp=%s&clientTags=%s",
                        baseUrl, env, appName,
                        clientIp != null ? clientIp : "",
                        clientTags != null ? clientTags : "");

                String requestBody = objectMapper.writeValueAsString(keys);

                Response httpResponse = Request.Post(url)
                        .bodyString(requestBody, org.apache.http.entity.ContentType.APPLICATION_JSON)
                        .connectTimeout(5000)
                        .socketTimeout(65000)
                        .execute();

                String response = httpResponse.returnContent().asString();
                JsonNode root = objectMapper.readTree(response);

                if (root.get("code").asInt() == 200 && root.has("data") && !root.get("data").isNull()) {
                    Map<String, String> changedConfigs = objectMapper.convertValue(root.get("data"), new TypeReference<Map<String, String>>() {});

                    if (!changedConfigs.isEmpty()) {
                        log.info("Received {} changed configs via batch polling", changedConfigs.size());
                        configCache.putAll(changedConfigs);
                        notifyListeners();
                    }
                }

            } catch (java.net.SocketTimeoutException e) {
                log.debug("Batch polling timeout, will retry");
            } catch (Exception e) {
                log.error("Batch polling error", e);
                try {
                    TimeUnit.SECONDS.sleep(5);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }, 1, 0, TimeUnit.SECONDS);
    }

    private void startSseConnection() {
        sseFuture = sseExecutor.submit(this::runSseConnection);
    }

    private void runSseConnection() {
        int retryCount = 0;
        int maxRetryDelay = 30000;

        while (running.get()) {
            HttpURLConnection connection = null;
            try {
                String url = String.format("%s/api/config/sse/%s/%s/%s?clientIp=%s&clientTags=%s",
                        baseUrl, env, appName, clientId,
                        clientIp != null ? clientIp : "",
                        clientTags != null ? clientTags : "");

                log.info("Connecting to SSE: {}", url);

                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept", "text/event-stream");
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(0);
                connection.connect();

                int responseCode = connection.getResponseCode();
                if (responseCode != 200) {
                    throw new IOException("SSE connection failed: HTTP " + responseCode);
                }

                log.info("SSE connected");
                retryCount = 0;

                try (InputStream is = connection.getInputStream();
                     BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {

                    String line;
                    StringBuilder eventData = new StringBuilder();
                    String eventName = null;

                    while (running.get() && (line = reader.readLine()) != null) {
                        if (line.startsWith("event:")) {
                            eventName = line.substring(6).trim();
                        } else if (line.startsWith("data:")) {
                            eventData.append(line.substring(5).trim());
                        } else if (line.isEmpty() && eventData.length() > 0) {
                            handleSseEvent(eventName, eventData.toString());
                            eventData.setLength(0);
                            eventName = null;
                        }
                    }
                }

            } catch (Exception e) {
                if (running.get()) {
                    log.error("SSE connection error, will retry", e);
                    retryCount++;
                    int delay = Math.min(1000 * (int) Math.pow(2, Math.min(retryCount, 5) - 1), maxRetryDelay);
                    try {
                        TimeUnit.MILLISECONDS.sleep(delay);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
        log.info("SSE connection thread exited");
    }

    private void handleSseEvent(String eventName, String data) {
        try {
            if ("connected".equals(eventName)) {
                log.info("SSE connected confirmed: {}", data);
                return;
            }

            if ("config-change".equals(eventName)) {
                ConfigItem configItem = objectMapper.readValue(data, ConfigItem.class);

                if ("GRAY_CHANGE".equals(configItem.getVersion())) {
                    log.info("Gray config change detected, reloading all configs");
                    loadAllConfigs();
                    notifyListeners();
                } else {
                    String newValue = getConfigValueFromServer(configItem.getKey());
                    if (newValue != null) {
                        String oldValue = configCache.put(configItem.getKey(), newValue);
                        if (!newValue.equals(oldValue)) {
                            log.info("Config changed via SSE: key={}, oldValue={}, newValue={}", configItem.getKey(), oldValue, newValue);
                            notifyListeners();
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.error("Handle SSE event error", e);
        }
    }

    private String getConfigValueFromServer(String key) {
        try {
            String url = String.format("%s/api/config/client/%s/%s/%s?clientIp=%s&clientTags=%s",
                    baseUrl, env, appName, key,
                    clientIp != null ? clientIp : "",
                    clientTags != null ? clientTags : "");

            String response = Request.Get(url)
                    .connectTimeout(5000)
                    .socketTimeout(10000)
                    .execute()
                    .returnContent()
                    .asString();

            JsonNode root = objectMapper.readTree(response);
            if (root.get("code").asInt() == 200) {
                return root.get("data").asText();
            }
        } catch (IOException e) {
            log.error("Failed to get config value from server", e);
        }
        return null;
    }

    private void notifyListeners() {
        Map<String, String> configs = getAllConfigs();
        for (Consumer<Map<String, String>> listener : listeners) {
            try {
                listener.accept(configs);
            } catch (Exception e) {
                log.error("Notify listener error", e);
            }
        }
    }

    @lombok.Data
    public static class ConfigItem {
        private String key;
        private String value;
        private String env;
        private String appName;
        private String version;
    }
}
