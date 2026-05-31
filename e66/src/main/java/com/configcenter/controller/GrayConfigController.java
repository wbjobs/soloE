package com.configcenter.controller;

import com.configcenter.model.GrayConfig;
import com.configcenter.model.Result;
import com.configcenter.service.GrayConfigService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Slf4j
@RestController
@RequestMapping("/api/gray")
public class GrayConfigController {

    private final GrayConfigService grayConfigService;

    public GrayConfigController(GrayConfigService grayConfigService) {
        this.grayConfigService = grayConfigService;
    }

    @GetMapping("/{env}/{appName}/{key}")
    public Result<GrayConfig> getGrayConfig(@PathVariable String env, @PathVariable String appName, @PathVariable String key) {
        GrayConfig config = grayConfigService.getGrayConfig(env, appName, key);
        return Result.success(config);
    }

    @GetMapping("/{env}/{appName}")
    public Result<List<GrayConfig>> listGrayConfigs(@PathVariable String env, @PathVariable String appName) {
        List<GrayConfig> configs = grayConfigService.listGrayConfigs(env, appName);
        return Result.success(configs);
    }

    @PostMapping
    public Result<GrayConfig> createGrayConfig(@RequestBody GrayConfig grayConfig) {
        GrayConfig created = grayConfigService.createGrayConfig(grayConfig);
        return Result.success(created);
    }

    @DeleteMapping("/{env}/{appName}/{key}")
    public Result<Void> deleteGrayConfig(@PathVariable String env, @PathVariable String appName, @PathVariable String key) {
        grayConfigService.deleteGrayConfig(env, appName, key);
        return Result.success();
    }
}
