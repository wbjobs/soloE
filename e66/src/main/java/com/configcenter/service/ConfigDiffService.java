package com.configcenter.service;

import com.configcenter.model.ConfigHistory;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Slf4j
@Service
public class ConfigDiffService {

    private final ObjectMapper objectMapper;

    public ConfigDiffService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiffResult {
        private String oldVersion;
        private String newVersion;
        private String oldValue;
        private String newValue;
        private List<DiffLine> diffLines;
        private String operation;
        private String operator;
        private java.time.LocalDateTime timestamp;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiffLine {
        private String type;
        private String content;
        private int oldLineNumber;
        private int newLineNumber;
    }

    public DiffResult compareVersions(ConfigHistory older, ConfigHistory newer) {
        String oldValue = older.getValue() != null ? older.getValue() : "";
        String newValue = newer.getValue() != null ? newer.getValue() : "";

        List<DiffLine> diffLines = computeLineDiff(oldValue, newValue);

        return DiffResult.builder()
                .oldVersion(older.getVersion())
                .newVersion(newer.getVersion())
                .oldValue(oldValue)
                .newValue(newValue)
                .diffLines(diffLines)
                .operation(newer.getOperation())
                .operator(newer.getOperator())
                .timestamp(newer.getTimestamp())
                .build();
    }

    private List<DiffLine> computeLineDiff(String oldText, String newText) {
        String[] oldLines = oldText.split("\n", -1);
        String[] newLines = newText.split("\n", -1);

        List<DiffLine> result = new ArrayList<>();

        int[][] dp = new int[oldLines.length + 1][newLines.length + 1];

        for (int i = oldLines.length - 1; i >= 0; i--) {
            for (int j = newLines.length - 1; j >= 0; j--) {
                if (oldLines[i].equals(newLines[j])) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        int i = 0, j = 0;
        while (i < oldLines.length && j < newLines.length) {
            if (oldLines[i].equals(newLines[j])) {
                result.add(DiffLine.builder()
                        .type("UNCHANGED")
                        .content(oldLines[i])
                        .oldLineNumber(i + 1)
                        .newLineNumber(j + 1)
                        .build());
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                result.add(DiffLine.builder()
                        .type("DELETE")
                        .content(oldLines[i])
                        .oldLineNumber(i + 1)
                        .newLineNumber(-1)
                        .build());
                i++;
            } else {
                result.add(DiffLine.builder()
                        .type("INSERT")
                        .content(newLines[j])
                        .oldLineNumber(-1)
                        .newLineNumber(j + 1)
                        .build());
                j++;
            }
        }

        while (i < oldLines.length) {
            result.add(DiffLine.builder()
                    .type("DELETE")
                    .content(oldLines[i])
                    .oldLineNumber(i + 1)
                    .newLineNumber(-1)
                    .build());
            i++;
        }

        while (j < newLines.length) {
            result.add(DiffLine.builder()
                    .type("INSERT")
                    .content(newLines[j])
                    .oldLineNumber(-1)
                    .newLineNumber(j + 1)
                    .build());
            j++;
        }

        return result;
    }
}
