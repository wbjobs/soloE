package com.example.logquery.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class LogQueryControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    private String createTestLogs(int count) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < count; i++) {
            String level = i % 2 == 0 ? "ERROR" : "INFO";
            sb.append(String.format("[2024-01-15 10:%02d:00] [%s] [test-service] Log entry %d\\n", i, level, i));
        }
        return sb.toString();
    }

    @Test
    void testQueryWithHyphenatedModule() throws Exception {
        String requestBody = "{\n" +
                "  \"log_content\": \"[2024-01-15 10:00:00] [ERROR] [user-service] Authentication failed\\n" +
                "[2024-01-15 10:00:01] [INFO] [auth-service] Login successful\\n" +
                "[2024-01-15 10:00:02] [ERROR] [payment-service] Transaction failed\",\n" +
                "  \"query\": \"level=ERROR AND module=payment-service\"\n" +
                "}";

        mockMvc.perform(post("/api/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].module").value("payment-service"))
                .andExpect(jsonPath("$.content[0].level").value("ERROR"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void testQueryWithComplexHyphenatedModule() throws Exception {
        String requestBody = "{\n" +
                "  \"log_content\": \"[2024-01-15 10:00:00] [WARN] [api-gateway-v2-prod] Rate limit exceeded\\n" +
                "[2024-01-15 10:00:01] [ERROR] [user-management-service-v3] Database connection error\",\n" +
                "  \"query\": \"module=user-management-service-v3\"\n" +
                "}";

        mockMvc.perform(post("/api/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].module").value("user-management-service-v3"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void testPaginationFirstPage() throws Exception {
        String requestBody = String.format("{\n" +
                "  \"log_content\": \"%s\",\n" +
                "  \"query\": \"\"\n" +
                "}", createTestLogs(5));

        mockMvc.perform(post("/api/query?page=0&size=2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.totalElements").value(5))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2));
    }

    @Test
    void testPaginationWithDefaultValues() throws Exception {
        String requestBody = String.format("{\n" +
                "  \"log_content\": \"%s\",\n" +
                "  \"query\": \"\"\n" +
                "}", createTestLogs(15));

        mockMvc.perform(post("/api/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(10))
                .andExpect(jsonPath("$.totalElements").value(15))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(10));
    }

    @Test
    void testPaginationWithFilter() throws Exception {
        String requestBody = String.format("{\n" +
                "  \"log_content\": \"%s\",\n" +
                "  \"query\": \"level=ERROR\"\n" +
                "}", createTestLogs(10));

        mockMvc.perform(post("/api/query?page=0&size=5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(5))
                .andExpect(jsonPath("$.totalElements").value(5));
    }
}
