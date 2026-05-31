package com.scheduler.controller;

import com.scheduler.dto.ApiResponse;
import com.scheduler.dto.DAGEdgeRequest;
import com.scheduler.dto.DAGRequest;
import com.scheduler.dto.TaskRequest;
import com.scheduler.entity.DAG;
import com.scheduler.entity.DAGEdge;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskPriority;
import com.scheduler.enums.TaskStatus;
import com.scheduler.enums.TaskType;
import com.scheduler.service.DAGService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Slf4j
@RestController
@RequestMapping("/dags")
@RequiredArgsConstructor
public class DAGController {

    private final DAGService dagService;

    @PostMapping
    public ApiResponse<DAG> createDAG(@Valid @RequestBody DAGRequest request) {
        DAG dag = dagService.createDAG(request.getName(), request.getDescription());
        log.info("Created DAG: {}", dag.getId());
        return ApiResponse.success("DAG created successfully", dag);
    }

    @PostMapping("/{dagId}/edges")
    public ApiResponse<Void> addEdge(@PathVariable String dagId, @Valid @RequestBody DAGEdgeRequest request) {
        dagService.addEdge(dagId, request.getFromTask(), request.getToTask());
        log.info("Added edge to DAG {}: {} -> {}", dagId, request.getFromTask(), request.getToTask());
        return ApiResponse.success("Edge added successfully", null);
    }

    @PostMapping("/{dagId}/submit")
    public ApiResponse<List<TaskInstance>> submitDAG(@PathVariable String dagId,
                                                      @RequestBody List<TaskRequest> taskRequests) {
        List<TaskInstance> tasks = new ArrayList<>();

        for (TaskRequest request : taskRequests) {
            TaskInstance task = new TaskInstance();
            task.setTaskName(request.getTaskName());
            task.setType(TaskType.valueOf(request.getType().toUpperCase()));
            task.setPriority(TaskPriority.valueOf(request.getPriority().toUpperCase()));
            task.setPayload(request.getPayload());
            task.setStatus(TaskStatus.PENDING);
            task.setMaxRetries(request.getMaxRetries());
            task.setRetryCount(0);
            task.setTimeoutMs(request.getTimeoutMs() != null ? request.getTimeoutMs() : 300000L);
            tasks.add(task);
        }

        dagService.submitDAG(dagId, tasks);
        log.info("Submitted {} tasks to DAG {}", tasks.size(), dagId);

        return ApiResponse.success("DAG submitted successfully", tasks);
    }

    @GetMapping("/{dagId}")
    public ApiResponse<DAG> getDAG(@PathVariable String dagId) {
        Optional<DAG> dag = dagService.getDAG(dagId);
        return dag.map(d -> ApiResponse.success(d))
                .orElse(ApiResponse.error("DAG not found"));
    }

    @GetMapping("/{dagId}/edges")
    public ApiResponse<List<DAGEdge>> getDAGEdges(@PathVariable String dagId) {
        List<DAGEdge> edges = dagService.getDAGEdges(dagId);
        return ApiResponse.success(edges);
    }

    @GetMapping("/{dagId}/tasks")
    public ApiResponse<List<TaskInstance>> getDAGTasks(@PathVariable String dagId) {
        List<TaskInstance> tasks = dagService.getDAGTasks(dagId);
        return ApiResponse.success(tasks);
    }
}
