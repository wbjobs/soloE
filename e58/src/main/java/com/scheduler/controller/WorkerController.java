package com.scheduler.controller;

import com.scheduler.dto.ApiResponse;
import com.scheduler.entity.WorkerNode;
import com.scheduler.service.WorkerRegistryService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/workers")
@RequiredArgsConstructor
public class WorkerController {

    private final WorkerRegistryService workerRegistryService;

    @GetMapping
    public ApiResponse<List<WorkerNode>> getAllWorkers() {
        return ApiResponse.success(workerRegistryService.getAllWorkers());
    }

    @GetMapping("/current")
    public ApiResponse<String> getCurrentWorkerId() {
        return ApiResponse.success(workerRegistryService.getCurrentWorkerId());
    }
}
