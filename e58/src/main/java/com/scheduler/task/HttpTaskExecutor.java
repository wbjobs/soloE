package com.scheduler.task;

import com.alibaba.fastjson2.JSON;
import com.scheduler.entity.TaskInstance;
import com.scheduler.enums.TaskType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Slf4j
@Component
public class HttpTaskExecutor implements TaskExecutor {

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String execute(TaskInstance task) throws Exception {
        log.info("Executing HTTP task: {}", task.getId());

        HttpTaskPayload payload = JSON.parseObject(task.getPayload(), HttpTaskPayload.class);

        HttpHeaders headers = new HttpHeaders();
        if (payload.getHeaders() != null) {
            payload.getHeaders().forEach(headers::add);
        }

        HttpEntity<String> entity = new HttpEntity<>(payload.getBody(), headers);

        ResponseEntity<String> response = restTemplate.exchange(
                payload.getUrl(),
                HttpMethod.valueOf(payload.getMethod()),
                entity,
                String.class
        );

        log.info("HTTP task completed: {}, status: {}", task.getId(), response.getStatusCode());

        return JSON.toJSONString(Map.of(
                "statusCode", response.getStatusCode().value(),
                "body", response.getBody()
        ));
    }

    @Override
    public boolean supports(String type) {
        return TaskType.HTTP.name().equals(type);
    }

    public static class HttpTaskPayload {
        private String url;
        private String method = "GET";
        private String body;
        private Map<String, String> headers;

        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }
        public String getMethod() { return method; }
        public void setMethod(String method) { this.method = method; }
        public String getBody() { return body; }
        public void setBody(String body) { this.body = body; }
        public Map<String, String> getHeaders() { return headers; }
        public void setHeaders(Map<String, String> headers) { this.headers = headers; }
    }
}
