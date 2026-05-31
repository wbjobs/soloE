package com.example.logquery.service;

import com.example.logquery.model.LogEntry;
import com.example.logquery.model.PageResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class QueryFilterServiceTest {

    private QueryFilterService queryFilterService;
    private List<LogEntry> testLogs;

    @BeforeEach
    void setUp() {
        queryFilterService = new QueryFilterService();
        testLogs = Arrays.asList(
                new LogEntry("2024-01-15 10:00:00", "ERROR", "user-service", "User authentication failed"),
                new LogEntry("2024-01-15 10:00:01", "INFO", "auth-service", "Login successful"),
                new LogEntry("2024-01-15 10:00:02", "WARN", "api-gateway", "Connection timeout"),
                new LogEntry("2024-01-15 10:00:03", "ERROR", "payment-service", "Transaction failed")
        );
    }

    @Test
    void testFilterByModuleWithHyphen() {
        List<LogEntry> result = queryFilterService.filterLogs(testLogs, "module=user-service");
        assertEquals(1, result.size());
        assertEquals("user-service", result.get(0).getModule());
    }

    @Test
    void testFilterByModuleWithMultipleHyphens() {
        List<LogEntry> result = queryFilterService.filterLogs(testLogs, "module=api-gateway");
        assertEquals(1, result.size());
        assertEquals("api-gateway", result.get(0).getModule());
    }

    @Test
    void testFilterByMultipleConditionsWithHyphen() {
        List<LogEntry> result = queryFilterService.filterLogs(testLogs, "level=ERROR AND module=payment-service");
        assertEquals(1, result.size());
        assertEquals("payment-service", result.get(0).getModule());
        assertEquals("ERROR", result.get(0).getLevel());
    }

    @Test
    void testPaginationFirstPage() {
        PageResponse<LogEntry> result = queryFilterService.filterLogsWithPagination(testLogs, "", 0, 2);
        assertEquals(2, result.getContent().size());
        assertEquals(4, result.getTotalElements());
        assertEquals(2, result.getTotalPages());
        assertEquals(0, result.getPage());
        assertEquals(2, result.getSize());
        assertEquals("user-service", result.getContent().get(0).getModule());
        assertEquals("auth-service", result.getContent().get(1).getModule());
    }

    @Test
    void testPaginationSecondPage() {
        PageResponse<LogEntry> result = queryFilterService.filterLogsWithPagination(testLogs, "", 1, 2);
        assertEquals(2, result.getContent().size());
        assertEquals(4, result.getTotalElements());
        assertEquals("api-gateway", result.getContent().get(0).getModule());
        assertEquals("payment-service", result.getContent().get(1).getModule());
    }

    @Test
    void testPaginationEmptyPage() {
        PageResponse<LogEntry> result = queryFilterService.filterLogsWithPagination(testLogs, "", 10, 2);
        assertEquals(0, result.getContent().size());
        assertEquals(4, result.getTotalElements());
        assertEquals(2, result.getTotalPages());
    }

    @Test
    void testPaginationWithFilter() {
        PageResponse<LogEntry> result = queryFilterService.filterLogsWithPagination(testLogs, "level=ERROR", 0, 10);
        assertEquals(2, result.getContent().size());
        assertEquals(2, result.getTotalElements());
        assertEquals(1, result.getTotalPages());
    }
}
