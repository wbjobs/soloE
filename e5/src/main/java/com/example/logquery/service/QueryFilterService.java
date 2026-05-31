package com.example.logquery.service;

import com.example.logquery.model.LogEntry;
import com.example.logquery.model.PageResponse;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

@Service
public class QueryFilterService {

    public List<LogEntry> filterLogs(List<LogEntry> logEntries, String query) {
        List<LogEntry> result = new ArrayList<>();
        Predicate<LogEntry> filterPredicate = parseQuery(query);

        for (LogEntry entry : logEntries) {
            if (filterPredicate.test(entry)) {
                result.add(entry);
            }
        }
        return result;
    }

    public PageResponse<LogEntry> filterLogsWithPagination(List<LogEntry> logEntries, String query, int page, int size) {
        List<LogEntry> filteredLogs = filterLogs(logEntries, query);
        int totalElements = filteredLogs.size();

        int fromIndex = page * size;
        if (fromIndex >= totalElements) {
            return new PageResponse<>(new ArrayList<>(), page, size, totalElements);
        }

        int toIndex = Math.min(fromIndex + size, totalElements);
        List<LogEntry> paginatedContent = filteredLogs.subList(fromIndex, toIndex);

        return new PageResponse<>(new ArrayList<>(paginatedContent), page, size, totalElements);
    }

    private Predicate<LogEntry> parseQuery(String query) {
        if (query == null || query.trim().isEmpty()) {
            return entry -> true;
        }

        String[] conditions = query.split("\\s+AND\\s+");
        List<Predicate<LogEntry>> predicates = new ArrayList<>();

        for (String condition : conditions) {
            condition = condition.trim();
            if (condition.startsWith("(") && condition.endsWith(")")) {
                condition = condition.substring(1, condition.length() - 1).trim();
            }
            Predicate<LogEntry> predicate = parseCondition(condition);
            if (predicate != null) {
                predicates.add(predicate);
            }
        }

        return predicates.stream()
                .reduce(entry -> true, Predicate::and);
    }

    private Predicate<LogEntry> parseCondition(String condition) {
        String[] parts = condition.split("=", 2);
        if (parts.length != 2) {
            return entry -> true;
        }

        String field = parts[0].trim().toLowerCase();
        String value = parts[1].trim();

        if (value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length() - 1);
        }
        if (value.startsWith("'") && value.endsWith("'")) {
            value = value.substring(1, value.length() - 1);
        }

        final String matchValue = value;

        switch (field) {
            case "level":
                return entry -> safeEqualsIgnoreCase(entry.getLevel(), matchValue);
            case "module":
                return entry -> safeEqualsIgnoreCase(entry.getModule(), matchValue);
            case "timestamp":
                return entry -> safeContains(entry.getTimestamp(), matchValue);
            case "message":
                return entry -> safeContainsIgnoreCase(entry.getMessage(), matchValue);
            default:
                return entry -> true;
        }
    }

    private boolean safeEqualsIgnoreCase(String str1, String str2) {
        if (str1 == null || str2 == null) {
            return false;
        }
        return str1.equalsIgnoreCase(str2);
    }

    private boolean safeContains(String str, String substring) {
        if (str == null || substring == null) {
            return false;
        }
        return str.contains(substring);
    }

    private boolean safeContainsIgnoreCase(String str, String substring) {
        if (str == null || substring == null) {
            return false;
        }
        return str.toLowerCase().contains(substring.toLowerCase());
    }
}
