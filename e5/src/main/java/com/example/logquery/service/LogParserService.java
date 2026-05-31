package com.example.logquery.service;

import com.example.logquery.model.LogEntry;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class LogParserService {

    private static final Pattern LOG_PATTERN = Pattern.compile("\\[(.*?)\\]\\s*\\[(.*?)\\]\\s*\\[(.*?)\\]\\s*(.*)");

    public List<LogEntry> parseLogs(String logContent) {
        List<LogEntry> logEntries = new ArrayList<>();
        String[] lines = logContent.split("\\r?\\n");

        for (String line : lines) {
            if (line.trim().isEmpty()) {
                continue;
            }
            Matcher matcher = LOG_PATTERN.matcher(line);
            if (matcher.matches()) {
                LogEntry entry = new LogEntry();
                entry.setTimestamp(matcher.group(1));
                entry.setLevel(matcher.group(2));
                entry.setModule(matcher.group(3));
                entry.setMessage(matcher.group(4).trim());
                logEntries.add(entry);
            }
        }
        return logEntries;
    }
}
