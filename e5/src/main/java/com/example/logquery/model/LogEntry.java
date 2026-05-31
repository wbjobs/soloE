package com.example.logquery.model;

public class LogEntry {
    private String timestamp;
    private String level;
    private String module;
    private String message;

    public LogEntry() {
    }

    public LogEntry(String timestamp, String level, String module, String message) {
        this.timestamp = timestamp;
        this.level = level;
        this.module = module;
        this.message = message;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }

    public String getLevel() {
        return level;
    }

    public void setLevel(String level) {
        this.level = level;
    }

    public String getModule() {
        return module;
    }

    public void setModule(String module) {
        this.module = module;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
