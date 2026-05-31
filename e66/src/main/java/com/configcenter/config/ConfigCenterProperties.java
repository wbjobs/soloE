package com.configcenter.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "config")
public class ConfigCenterProperties {

    private String basePath = "/config-center";
    private int historyLimit = 100;
    private long longPollTimeout = 60000;

    public String getConfigPath(String env, String appName, String key) {
        return String.format("%s/%s/%s/%s", basePath, env, appName, key);
    }

    public String getEnvPath(String env) {
        return String.format("%s/%s", basePath, env);
    }

    public String getAppPath(String env, String appName) {
        return String.format("%s/%s/%s", basePath, env, appName);
    }

    public String getHistoryPath(String env, String appName, String key) {
        return String.format("%s/history/%s/%s/%s", basePath, env, appName, key);
    }

    public String getGrayPath(String env, String appName, String key) {
        return String.format("%s/gray/%s/%s/%s", basePath, env, appName, key);
    }

    public String getRoutePath() {
        return String.format("%s/routes", basePath);
    }
}
