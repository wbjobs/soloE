package com.configcenter.service;

import com.configcenter.config.ConfigCenterProperties;
import com.configcenter.model.RouteConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.etcd.jetcd.ByteSequence;
import io.etcd.jetcd.Client;
import io.etcd.jetcd.KeyValue;
import io.etcd.jetcd.kv.GetResponse;
import io.etcd.jetcd.options.GetOption;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

@Slf4j
@Service
public class RouteConfigService {

    private final Client etcdClient;
    private final ConfigCenterProperties properties;
    private final ObjectMapper objectMapper;
    private final CopyOnWriteArrayList<Consumer<List<RouteConfig>>> routeListeners = new CopyOnWriteArrayList<>();

    public RouteConfigService(Client etcdClient, ConfigCenterProperties properties, ObjectMapper objectMapper) {
        this.etcdClient = etcdClient;
        this.properties = properties;
        this.objectMapper = objectMapper;
        startRouteWatch();
    }

    public RouteConfig createRoute(RouteConfig route) {
        try {
            String path = properties.getRoutePath() + "/" + route.getId();
            byte[] value = objectMapper.writeValueAsBytes(route);

            etcdClient.getKVClient().put(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            notifyRouteChange();
            return route;
        } catch (Exception e) {
            log.error("Create route error", e);
            throw new RuntimeException("创建路由失败", e);
        }
    }

    public RouteConfig updateRoute(RouteConfig route) {
        try {
            RouteConfig oldRoute = getRoute(route.getId());
            if (oldRoute == null) {
                throw new RuntimeException("路由不存在");
            }

            String path = properties.getRoutePath() + "/" + route.getId();
            byte[] value = objectMapper.writeValueAsBytes(route);

            etcdClient.getKVClient().put(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    ByteSequence.from(value)
            ).get();

            notifyRouteChange();
            return route;
        } catch (Exception e) {
            log.error("Update route error", e);
            throw new RuntimeException("更新路由失败", e);
        }
    }

    public void deleteRoute(String routeId) {
        try {
            String path = properties.getRoutePath() + "/" + routeId;
            etcdClient.getKVClient().delete(ByteSequence.from(path, StandardCharsets.UTF_8)).get();
            notifyRouteChange();
        } catch (Exception e) {
            log.error("Delete route error", e);
            throw new RuntimeException("删除路由失败", e);
        }
    }

    public RouteConfig getRoute(String routeId) {
        try {
            String path = properties.getRoutePath() + "/" + routeId;
            GetResponse response = etcdClient.getKVClient().get(ByteSequence.from(path, StandardCharsets.UTF_8)).get();
            if (response.getKvs().isEmpty()) {
                return null;
            }
            return objectMapper.readValue(response.getKvs().get(0).getValue().getBytes(), RouteConfig.class);
        } catch (Exception e) {
            log.error("Get route error", e);
            return null;
        }
    }

    public List<RouteConfig> listRoutes() {
        try {
            String path = properties.getRoutePath();
            GetResponse response = etcdClient.getKVClient().get(
                    ByteSequence.from(path, StandardCharsets.UTF_8),
                    GetOption.newBuilder().isPrefix(true).build()
            ).get();

            List<RouteConfig> routes = new ArrayList<>();
            for (KeyValue kv : response.getKvs()) {
                RouteConfig route = objectMapper.readValue(kv.getValue().getBytes(), RouteConfig.class);
                if ("ACTIVE".equals(route.getStatus())) {
                    routes.add(route);
                }
            }
            return routes;
        } catch (Exception e) {
            log.error("List routes error", e);
            return new ArrayList<>();
        }
    }

    public void addRouteListener(Consumer<List<RouteConfig>> listener) {
        routeListeners.add(listener);
    }

    public void removeRouteListener(Consumer<List<RouteConfig>> listener) {
        routeListeners.remove(listener);
    }

    private void notifyRouteChange() {
        List<RouteConfig> routes = listRoutes();
        for (Consumer<List<RouteConfig>> listener : routeListeners) {
            try {
                listener.accept(routes);
            } catch (Exception e) {
                log.error("Notify route change error", e);
            }
        }
    }

    private void startRouteWatch() {
        try {
            String watchPath = properties.getRoutePath();
            etcdClient.getWatchClient().watch(
                    ByteSequence.from(watchPath, StandardCharsets.UTF_8),
                    io.etcd.jetcd.options.WatchOption.newBuilder().isPrefix(true).build(),
                    response -> {
                        log.info("Route config changed, notifying {} listeners", routeListeners.size());
                        notifyRouteChange();
                    }
            );
            log.info("Route watch started on path: {}", watchPath);
        } catch (Exception e) {
            log.error("Start route watch error", e);
        }
    }
}
