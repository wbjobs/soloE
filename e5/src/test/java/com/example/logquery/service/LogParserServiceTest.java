package com.example.logquery.service;

import com.example.logquery.model.LogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class LogParserServiceTest {

    private LogParserService logParserService;

    @BeforeEach
    void setUp() {
        logParserService = new LogParserService();
    }

    @Test
    void testParseLogWithHyphenatedModule() {
        String logContent = "[2024-01-15 10:00:00] [ERROR] [user-service] Authentication failed\n" +
                            "[2024-01-15 10:00:01] [INFO] [api-gateway-v2] Request received";

        List<LogEntry> entries = logParserService.parseLogs(logContent);

        assertEquals(2, entries.size());
        assertEquals("user-service", entries.get(0).getModule());
        assertEquals("api-gateway-v2", entries.get(1).getModule());
        assertEquals("ERROR", entries.get(0).getLevel());
        assertEquals("2024-01-15 10:00:00", entries.get(0).getTimestamp());
    }

    @Test
    void testParseLogWithComplexModuleNames() {
        String logContent = "[2024-01-15 10:00:00] [WARN] [payment-service-v3-prod] Slow response detected\n" +
                            "[2024-01-15 10:00:01] [DEBUG] [my-awesome-app-service] Processing request";

        List<LogEntry> entries = logParserService.parseLogs(logContent);

        assertEquals(2, entries.size());
        assertEquals("payment-service-v3-prod", entries.get(0).getModule());
        assertEquals("my-awesome-app-service", entries.get(1).getModule());
    }
}
