package com.example.accesscontrol.cli;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class AccessControlCli {

    private static final String API_URL = "http://localhost:8080/api/access/check";
    private static final String TOKEN_API_URL = "http://localhost:8080/api/tokens/check";
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;
    private static final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule());

    public static void main(String[] args) {
        if (args.length < 1) {
            System.out.println("========================================");
            System.out.println("错误: 缺少命令参数");
            System.out.println("========================================");
            printUsage();
            System.exit(1);
        }

        String command = args[0];

        if ("--check".equals(command)) {
            if (args.length < 3) {
                System.out.println("========================================");
                System.out.println("错误: --check 命令需要两个参数");
                System.out.println("========================================");
                System.out.println("用法: java -jar access-control-cli.jar --check <uid> <datetime>");
                System.out.println();
                System.out.println("示例:");
                System.out.println("  java -jar access-control-cli.jar --check NFC001 2026-05-18T10:00:00");
                System.out.println();
                System.out.println("参数说明:");
                System.out.println("  <uid>       NFC卡唯一标识 (如: NFC001)");
                System.out.println("  <datetime>  刷卡时间，ISO-8601格式 (如: 2026-05-18T10:00:00)");
                System.out.println("              格式: yyyy-MM-dd'T'HH:mm:ss");
                System.out.println("========================================");
                System.exit(1);
            }
            String uid = args[1];
            String datetime = args[2];
            performCheck(uid, datetime);
        } else if ("--token".equals(command)) {
            if (args.length < 3) {
                System.out.println("========================================");
                System.out.println("错误: --token 命令需要两个参数");
                System.out.println("========================================");
                System.out.println("用法: java -jar access-control-cli.jar --token <code> <datetime>");
                System.out.println();
                System.out.println("示例:");
                System.out.println("  java -jar access-control-cli.jar --token 123456 2026-05-18T10:00:00");
                System.out.println();
                System.out.println("参数说明:");
                System.out.println("  <code>      6位临时访客码 (如: 123456)");
                System.out.println("  <datetime>  刷卡时间，ISO-8601格式 (如: 2026-05-18T10:00:00");
                System.out.println("              格式: yyyy-MM-dd'T'HH:mm:ss");
                System.out.println("========================================");
                System.exit(1);
            }
            String token = args[1];
            String datetime = args[2];
            performTokenCheck(token, datetime);
        } else if ("--help".equals(command) || "-h".equals(command)) {
            printUsage();
        } else {
            System.out.println("========================================");
            System.out.println("错误: 未知命令 '" + command + "'");
            System.out.println("========================================");
            System.out.println("支持的命令:");
            System.out.println("  --check <uid> <datetime>    模拟NFC卡刷卡检查");
            System.out.println("  --token <code> <datetime>   验证临时访客码");
            System.out.println("  --help, -h                  显示帮助信息");
            System.out.println();
            printUsage();
            System.exit(1);
        }
    }

    private static void performCheck(String uid, String datetime) {
        try {
            LocalDateTime.parse(datetime, FORMATTER);
        } catch (Exception e) {
            System.out.println("========================================");
            System.out.println("错误: 时间格式不正确");
            System.out.println("========================================");
            System.out.println("输入的时间: " + datetime);
            System.out.println();
            System.out.println("请使用 ISO-8601 格式，例如:");
            System.out.println("  2026-05-18T10:00:00  (2026年5月18日 上午10点)");
            System.out.println("  2026-05-18T20:30:00  (2026年5月18日 晚上8点30分)");
            System.out.println();
            System.out.println("格式说明:");
            System.out.println("  yyyy-MM-dd'T'HH:mm:ss");
            System.out.println("  |||| ||||  || || ||");
            System.out.println("  |||| ||||  || || ||");
            System.out.println("  |||| ||||  || || +--- 秒 (00-59)");
            System.out.println("  |||| ||||  || +----- 分 (00-59)");
            System.out.println("  |||| ||||  +------- 时 (00-23)");
            System.out.println("  |||| |||+---------- 日 (01-31)");
            System.out.println("  |||| +------------ 月 (01-12)");
            System.out.println("  ++++-------------- 年");
            System.out.println("========================================");
            System.exit(1);
        }

        try {
            String encodedUid = URLEncoder.encode(uid, "UTF-8");
            String encodedDatetime = URLEncoder.encode(datetime, "UTF-8");
            String requestUrl = API_URL + "?uid=" + encodedUid + "&datetime=" + encodedDatetime;

            URL url = URI.create(requestUrl).toURL();
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            int responseCode = conn.getResponseCode();

            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                AccessCheckResponse result = objectMapper.readValue(
                        response.toString(), AccessCheckResponse.class);
                printResult(result);
            } else {
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getErrorStream(), "UTF-8"));
                StringBuilder error = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    error.append(line);
                }
                reader.close();
                System.out.println("Request failed (HTTP " + responseCode + "): " + error);
                System.exit(1);
            }
        } catch (java.net.ConnectException e) {
            System.out.println("========================================");
            System.out.println("错误: 无法连接到后端服务");
            System.out.println("========================================");
            System.out.println("请确保后端服务已启动:");
            System.out.println();
            System.out.println("  1. 进入后端项目目录:");
            System.out.println("     cd access-control-backend");
            System.out.println();
            System.out.println("  2. 启动服务:");
            System.out.println("     mvn spring-boot:run");
            System.out.println();
            System.out.println("服务地址: http://localhost:8080");
            System.out.println("========================================");
            System.exit(1);
        } catch (java.net.SocketTimeoutException e) {
            System.out.println("========================================");
            System.out.println("错误: 连接超时");
            System.out.println("========================================");
            System.out.println("后端服务响应超时，请检查:");
            System.out.println("  - 服务是否正常运行");
            System.out.println("  - 网络连接是否正常");
            System.out.println("========================================");
            System.exit(1);
        } catch (Exception e) {
            System.out.println("========================================");
            System.out.println("错误: 执行过程中发生异常");
            System.out.println("========================================");
            System.out.println("错误信息: " + e.getMessage());
            System.out.println();
            System.out.println("请检查:");
            System.out.println("  1. 后端服务是否已启动");
            System.out.println("  2. 参数格式是否正确");
            System.out.println("  3. 网络连接是否正常");
            System.out.println("========================================");
            System.exit(1);
        }
    }

    private static void performTokenCheck(String token, String datetime) {
        try {
            LocalDateTime.parse(datetime, FORMATTER);
        } catch (Exception e) {
            System.out.println("========================================");
            System.out.println("错误: 时间格式不正确");
            System.out.println("========================================");
            System.out.println("输入的时间: " + datetime);
            System.out.println();
            System.out.println("请使用 ISO-8601 格式，例如:");
            System.out.println("  2026-05-18T10:00:00  (2026年5月18日 上午10点)");
            System.out.println("  2026-05-18T20:30:00  (2026年5月18日 晚上8点30分)");
            System.out.println();
            System.out.println("格式说明:");
            System.out.println("  yyyy-MM-dd'T'HH:mm:ss");
            System.out.println("  |||| ||||  || || ||");
            System.out.println("  |||| ||||  || || ||");
            System.out.println("  |||| ||||  || || +--- 秒 (00-59)");
            System.out.println("  |||| ||||  || +----- 分 (00-59)");
            System.out.println("  |||| ||||  +------- 时 (00-23)");
            System.out.println("  |||| |||+---------- 日 (01-31)");
            System.out.println("  |||| +------------ 月 (01-12)");
            System.out.println("  ++++-------------- 年");
            System.out.println("========================================");
            System.exit(1);
        }

        try {
            String encodedToken = URLEncoder.encode(token, "UTF-8");
            String encodedDatetime = URLEncoder.encode(datetime, "UTF-8");
            String requestUrl = TOKEN_API_URL + "?token=" + encodedToken + "&datetime=" + encodedDatetime;

            URL url = URI.create(requestUrl).toURL();
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            int responseCode = conn.getResponseCode();

            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), "UTF-8"));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                AccessCheckResponse result = objectMapper.readValue(
                        response.toString(), AccessCheckResponse.class);
                printTokenResult(result, token);
            } else {
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getErrorStream(), "UTF-8"));
                StringBuilder error = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    error.append(line);
                }
                reader.close();
                System.out.println("请求失败 (HTTP " + responseCode + "): " + error);
                System.exit(1);
            }
        } catch (java.net.ConnectException e) {
            System.out.println("========================================");
            System.out.println("错误: 无法连接到后端服务");
            System.out.println("========================================");
            System.out.println("请确保后端服务已启动:");
            System.out.println();
            System.out.println("  1. 进入后端项目目录:");
            System.out.println("     cd access-control-backend");
            System.out.println();
            System.out.println("  2. 启动服务:");
            System.out.println("     mvn spring-boot:run");
            System.out.println();
            System.out.println("服务地址: http://localhost:8080");
            System.out.println("========================================");
            System.exit(1);
        } catch (java.net.SocketTimeoutException e) {
            System.out.println("========================================");
            System.out.println("错误: 连接超时");
            System.out.println("========================================");
            System.out.println("后端服务响应超时，请检查:");
            System.out.println("  - 服务是否正常运行");
            System.out.println("  - 网络连接是否正常");
            System.out.println("========================================");
            System.exit(1);
        } catch (Exception e) {
            System.out.println("========================================");
            System.out.println("错误: 执行过程中发生异常");
            System.out.println("========================================");
            System.out.println("错误信息: " + e.getMessage());
            System.out.println();
            System.out.println("请检查:");
            System.out.println("  1. 后端服务是否已启动");
            System.out.println("  2. 参数格式是否正确");
            System.out.println("  3. 网络连接是否正常");
            System.out.println("========================================");
            System.exit(1);
        }
    }

    private static void printResult(AccessCheckResponse result) {
        System.out.println("========================================");
        System.out.println("NFC卡门禁检查结果");
        System.out.println("========================================");
        System.out.println("卡号 (UID):     " + result.getUid());
        System.out.println("检查时间:       " + result.getCheckTime());
        System.out.println("持卡人员:       " + (result.getPersonName() != null ? result.getPersonName() : "未绑定"));
        System.out.println("使用策略:       " + (result.getPolicyName() != null ? result.getPolicyName() : "无"));
        System.out.println("----------------------------------------");
        System.out.println("是否允许:       " + (result.isAllowed() ? "YES" : "NO"));
        System.out.println("说明:           " + result.getMessage());
        System.out.println("========================================");
    }

    private static void printTokenResult(AccessCheckResponse result, String token) {
        System.out.println("========================================");
        System.out.println("临时访客码验证结果");
        System.out.println("========================================");
        System.out.println("临时码:         " + token);
        System.out.println("检查时间:       " + result.getCheckTime());
        System.out.println("访客姓名:       " + (result.getPersonName() != null ? result.getPersonName() : "未设置"));
        System.out.println("使用策略:       " + (result.getPolicyName() != null ? result.getPolicyName() : "无"));
        System.out.println("----------------------------------------");
        System.out.println("是否允许:       " + (result.isAllowed() ? "YES" : "NO"));
        System.out.println("说明:           " + result.getMessage());
        System.out.println("========================================");
    }

    private static void printUsage() {
        System.out.println("Access Control System - Command Line Tool");
        System.out.println();
        System.out.println("Usage:");
        System.out.println("  java -jar access-control-cli.jar --check <uid> <datetime>");
        System.out.println("  java -jar access-control-cli.jar --token <code> <datetime>");
        System.out.println("  java -jar access-control-cli.jar --help");
        System.out.println();
        System.out.println("Arguments:");
        System.out.println("  --check <uid> <datetime>    Simulate NFC card swipe to check access");
        System.out.println("      <uid>                   NFC card unique identifier");
        System.out.println("      <datetime>              Check time (ISO-8601 format, e.g.: 2026-05-17T09:30:00)");
        System.out.println("  --token <code> <datetime>   Validate temporary visitor token");
        System.out.println("      <code>                  6-digit temporary token");
        System.out.println("      <datetime>              Check time (ISO-8601 format, e.g.: 2026-05-17T09:30:00)");
        System.out.println("  --help, -h                  Show this help message");
        System.out.println();
        System.out.println("Examples:");
        System.out.println("  java -jar access-control-cli.jar --check NFC001 2026-05-18T10:00:00");
        System.out.println("  java -jar access-control-cli.jar --token 123456 2026-05-18T10:00:00");
    }
}
