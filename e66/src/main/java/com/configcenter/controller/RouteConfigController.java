package com.configcenter.controller;

import com.configcenter.model.Result;
import com.configcenter.model.RouteConfig;
import com.configcenter.service.RouteConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api/route")
public class RouteConfigController {

    private final RouteConfigService routeConfigService;

    public RouteConfigController(RouteConfigService routeConfigService) {
        this.routeConfigService = routeConfigService;
    }

    @GetMapping("/{routeId}")
    public Result<RouteConfig> getRoute(@PathVariable String routeId) {
        RouteConfig route = routeConfigService.getRoute(routeId);
        return Result.success(route);
    }

    @GetMapping
    public Result<List<RouteConfig>> listRoutes() {
        List<RouteConfig> routes = routeConfigService.listRoutes();
        return Result.success(routes);
    }

    @PostMapping
    public Result<RouteConfig> createRoute(@RequestBody RouteConfig route) {
        RouteConfig created = routeConfigService.createRoute(route);
        return Result.success(created);
    }

    @PutMapping
    public Result<RouteConfig> updateRoute(@RequestBody RouteConfig route) {
        RouteConfig updated = routeConfigService.updateRoute(route);
        return Result.success(updated);
    }

    @DeleteMapping("/{routeId}")
    public Result<Void> deleteRoute(@PathVariable String routeId) {
        routeConfigService.deleteRoute(routeId);
        return Result.success();
    }
}
