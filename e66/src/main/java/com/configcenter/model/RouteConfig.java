package com.configcenter.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.LinkedHashMap;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RouteConfig {

    private String id;
    private String uri;
    private int order;
    private Map<String, String> predicates = new LinkedHashMap<>();
    private Map<String, String> filters = new LinkedHashMap<>();
    private String status;
}
