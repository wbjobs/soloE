package com.scheduler.task;

import com.alibaba.fastjson2.JSON;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.sql.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
public class SqlTaskExecutor implements TaskExecutor {

    @Override
    public String execute(TaskInstance task) throws Exception {
        log.info("Executing SQL task: {}", task.getId());

        SqlTaskPayload payload = JSON.parseObject(task.getPayload(), SqlTaskPayload.class);

        try (Connection connection = DriverManager.getConnection(
                payload.getJdbcUrl(),
                payload.getUsername(),
                payload.getPassword()
        )) {
            try (Statement statement = connection.createStatement()) {
                boolean hasResultSet = statement.execute(payload.getSql());

                if (hasResultSet) {
                    List<Map<String, Object>> results = new ArrayList<>();
                    try (ResultSet resultSet = statement.getResultSet()) {
                        ResultSetMetaData metaData = resultSet.getMetaData();
                        int columnCount = metaData.getColumnCount();

                        while (resultSet.next()) {
                            Map<String, Object> row = new HashMap<>();
                            for (int i = 1; i <= columnCount; i++) {
                                row.put(metaData.getColumnName(i), resultSet.getObject(i));
                            }
                            results.add(row);
                        }
                    }

                    log.info("SQL task completed: {} rows returned", results.size());
                    return JSON.toJSONString(Map.of("results", results));
                } else {
                    int updateCount = statement.getUpdateCount();
                    log.info("SQL task completed: {} rows affected", updateCount);
                    return JSON.toJSONString(Map.of("updateCount", updateCount));
                }
            }
        }
    }

    @Override
    public boolean supports(String type) {
        return TaskType.SQL.name().equals(type);
    }

    public static class SqlTaskPayload {
        private String jdbcUrl;
        private String username;
        private String password;
        private String sql;

        public String getJdbcUrl() { return jdbcUrl; }
        public void setJdbcUrl(String jdbcUrl) { this.jdbcUrl = jdbcUrl; }
        public String getUsername() { return username; }
        public void setUsername(String username) { this.username = username; }
        public String getPassword() { return password; }
        public void setPassword(String password) { this.password = password; }
        public String getSql() { return sql; }
        public void setSql(String sql) { this.sql = sql; }
    }
}
