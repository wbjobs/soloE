package com.configcenter.config;

import io.etcd.jetcd.Client;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Data
@Configuration
@ConfigurationProperties(prefix = "etcd")
public class EtcdConfig {

    private String endpoints = "http://localhost:2379";
    private String user;
    private String password;
    private int connectTimeout = 5000;
    private int retryDelay = 1000;
    private int maxRetries = 3;

    @Bean(destroyMethod = "close")
    public Client etcdClient() {
        return Client.builder().endpoints(endpoints.split(",")).build();
    }
}
