package com.example.logquery.model;

import javax.validation.constraints.NotBlank;

public class QueryRequest {

    @NotBlank(message = "log_content is required")
    private String log_content;

    private String query;

    public QueryRequest() {
    }

    public QueryRequest(String log_content, String query) {
        this.log_content = log_content;
        this.query = query;
    }

    public String getLog_content() {
        return log_content;
    }

    public void setLog_content(String log_content) {
        this.log_content = log_content;
    }

    public String getQuery() {
        return query;
    }

    public void setQuery(String query) {
        this.query = query;
    }
}
