package com.configcenter.example;

import com.configcenter.client.ConfigCenterClient;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public class ClientExample {

    public static void main(String[] args) {
        ConfigCenterClient client = new ConfigCenterClient(
                "http://localhost:8888",
                "dev",
                "my-app",
                "192.168.1.100",
                "{\"region\":\"cn\",\"version\":\"v1\"}"
        );

        client.setUseSse(true);

        client.addConfigChangeListener(configs -> {
            log.info("Configs changed! Current configs count: {}", configs.size());
        });

        client.start();

        Runtime.getRuntime().addShutdownHook(new Thread(client::stop));

        while (true) {
            try {
                Thread.sleep(5000);
                log.info("Current config value for 'db.url': {}", client.getConfig("db.url", "default"));
                log.info("Total configs: {}", client.getAllConfigs().size());
            } catch (InterruptedException e) {
                break;
            }
        }
    }
}
