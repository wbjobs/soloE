package com.example.logquery.controller;

import com.example.logquery.model.LogEntry;
import com.example.logquery.model.PageResponse;
import com.example.logquery.model.QueryRequest;
import com.example.logquery.service.LogParserService;
import com.example.logquery.service.QueryFilterService;
import javax.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class LogQueryController {

    private final LogParserService logParserService;
    private final QueryFilterService queryFilterService;

    private static final int DEFAULT_PAGE = 0;
    private static final int DEFAULT_SIZE = 10;
    private static final int MAX_SIZE = 100;

    @Autowired
    public LogQueryController(LogParserService logParserService, QueryFilterService queryFilterService) {
        this.logParserService = logParserService;
        this.queryFilterService = queryFilterService;
    }

    @PostMapping("/query")
    public ResponseEntity<PageResponse<LogEntry>> queryLogs(
            @Valid @RequestBody QueryRequest request,
            @RequestParam(defaultValue = "0") Integer page,
            @RequestParam(defaultValue = "10") Integer size) {

        int validPage = Math.max(page == null ? DEFAULT_PAGE : page, 0);
        int validSize = Math.min(Math.max(size == null ? DEFAULT_SIZE : size, 1), MAX_SIZE);

        List<LogEntry> allLogs = logParserService.parseLogs(request.getLog_content());
        PageResponse<LogEntry> paginatedResponse = queryFilterService.filterLogsWithPagination(
                allLogs, request.getQuery(), validPage, validSize);

        return ResponseEntity.ok(paginatedResponse);
    }
}
