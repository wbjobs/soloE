#!/bin/bash
# ==============================================================================
# P2P CDN ICE 配置诊断和测试脚本
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_test() {
    echo -e "${CYAN}[TEST]${NC} $1"
}

print_banner() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║     P2P CDN ICE Configuration Diagnostic Tool                  ║"
    echo "║     WebRTC 连接配置诊断工具                                    ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
}

# 检查依赖
check_dependencies() {
    log_info "检查系统依赖..."
    
    local missing=0
    
    # 检查 curl
    if command -v curl &> /dev/null; then
        log_success "curl: 已安装"
    else
        log_error "curl: 未安装，请先安装 curl"
        missing=1
    fi
    
    # 检查 netstat / ss
    if command -v netstat &> /dev/null || command -v ss &> /dev/null; then
        log_success "netstat/ss: 已安装"
    else
        log_warning "netstat/ss: 未安装，部分测试可能失败"
    fi
    
    # 检查 jq（JSON解析）
    if command -v jq &> /dev/null; then
        log_success "jq: 已安装"
    else
        log_warning "jq: 未安装，建议安装以便更好地显示测试结果"
    fi
    
    if [ $missing -eq 1 ]; then
        log_error "缺少必要依赖，请先安装后重试"
        exit 1
    fi
}

# 检测公网 IP
detect_public_ip() {
    log_test "检测公网 IP 地址..."
    
    local ips=()
    
    # 使用多个服务检测
    for service in "https://api.ipify.org" "https://ifconfig.me" "https://icanhazip.com"; do
        local ip=$(curl -s --connect-timeout 5 $service 2>/dev/null | grep -Eo '^[0-9\.]+$')
        if [ -n "$ip" ]; then
            ips+=("$ip")
            log_success "从 $service 获取到 IP: $ip"
        fi
    done
    
    # 去重
    local unique_ips=($(echo "${ips[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))
    
    if [ ${#unique_ips[@]} -eq 0 ]; then
        log_error "无法获取公网 IP 地址"
        PUBLIC_IP=""
    elif [ ${#unique_ips[@]} -gt 1 ]; then
        log_warning "检测到多个 IP 地址（可能存在 NAT 或多网卡）"
        PUBLIC_IP="${unique_ips[0]}"
    else
        PUBLIC_IP="${unique_ips[0]}"
        log_success "检测到公网 IP: $PUBLIC_IP"
    fi
}

# 测试 STUN 服务器
test_stun_server() {
    local server=$1
    local port=$2
    
    log_test "测试 STUN 服务器 $server:$port..."
    
    # 测试 UDP 连接
    if command -v nc &> /dev/null; then
        if nc -z -u -w 3 $server $port; then
            log_success "STUN UDP 端口可达"
        else
            log_error "STUN UDP 端口不可达"
        fi
    else
        # 使用 curl 测试 TCP
        if curl -s --connect-timeout 5 "stun:$server:$port" > /dev/null 2>&1 || true; then
            log_warning "UDP 测试需要 netcat (nc)，跳过 UDP 测试"
        fi
    fi
    
    # 测试 TCP 连接
    if curl -s --connect-timeout 5 "$server:$port" > /dev/null 2>&1 || true; then
        # STUN TCP 测试比较复杂，简化处理
        log_info "STUN TCP 端口测试完成"
    fi
}

# 测试 TURN 服务器
test_turn_server() {
    local server=$1
    local port=$2
    local user=$3
    local password=$4
    
    log_test "测试 TURN 服务器 $server:$port..."
    
    # 检查端口监听
    if command -v netstat &> /dev/null; then
        if netstat -tulpn | grep -q ":$port"; then
            log_success "TURN 端口 $port 正在监听"
        else
            log_error "TURN 端口 $port 未监听"
        fi
    fi
    
    # 测试 UDP
    if command -v nc &> /dev/null; then
        if nc -z -u -w 3 $server $port; then
            log_success "TURN UDP 端口可达"
        else
            log_error "TURN UDP 端口不可达"
        fi
    fi
}

# 检查防火墙配置
check_firewall() {
    log_test "检查防火墙配置..."
    
    local ports_to_check=("3478/udp" "3478/tcp" "5349/tcp")
    
    if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
        log_info "检测到 UFW 防火墙:"
        for port in "${ports_to_check[@]}"; do
            if ufw status | grep -q "$port"; then
                log_success "端口 $port 已开放"
            else
                log_warning "端口 $port 未在 UFW 规则中"
            fi
        done
    elif command -v firewall-cmd &> /dev/null && firewall-cmd --state > /dev/null 2>&1; then
        log_info "检测到 firewalld:"
        for port in "${ports_to_check[@]}"; do
            if firewall-cmd --list-ports | grep -q "${port/\//\/}"; then
                log_success "端口 $port 已开放"
            else
                log_warning "端口 $port 未在 firewalld 规则中"
            fi
        done
    else
        log_warning "未检测到防火墙或防火墙未启用"
        log_info "请手动确保以下端口已开放: 3478/udp, 3478/tcp, 5349/tcp, 49152-65535/udp"
    fi
}

# 检查 Coturn 服务状态
check_coturn_service() {
    log_test "检查 Coturn 服务状态..."
    
    if systemctl is-active --quiet coturn 2>/dev/null; then
        log_success "Coturn 服务正在运行"
        
        # 显示资源使用情况
        local cpu_usage=$(ps -p $(pgrep turnserver | head -1) -o %cpu= 2>/dev/null || echo "N/A")
        local mem_usage=$(ps -p $(pgrep turnserver | head -1) -o %mem= 2>/dev/null || echo "N/A")
        log_info "CPU 使用: $cpu_usage%"
        log_info "内存使用: $mem_usage%"
        
        # 检查日志文件
        if [ -f /var/log/turnserver/turnserver.log ]; then
            local error_count=$(grep -i error /var/log/turnserver/turnserver.log | wc -l)
            local warn_count=$(grep -i warn /var/log/turnserver/turnserver.log | wc -l)
            log_info "日志错误数: $error_count"
            log_info "日志警告数: $warn_count"
        fi
    else
        log_error "Coturn 服务未运行"
        
        # 尝试查找进程
        if pgrep -x "turnserver" > /dev/null; then
            log_warning "检测到 turnserver 进程但未被 systemd 管理"
        else
            log_info "未找到 turnserver 进程"
        fi
    fi
}

# 测试 NAT 类型
detect_nat_type() {
    log_test "检测 NAT 类型（简化版）..."
    
    # 这是一个简化的 NAT 检测
    # 真实的 NAT 检测需要 STUN 客户端
    
    if [ -n "$PUBLIC_IP" ]; then
        local local_ips=$(hostname -I | tr ' ' '\n' | grep -E '^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.')
        
        if [ -n "$local_ips" ]; then
            log_info "检测到本地内网 IP:"
            for ip in $local_ips; do
                log_info "  - $ip"
            done
            log_success "系统位于 NAT 后面（公网 IP: $PUBLIC_IP）"
            log_info "提示：NAT 环境下必须正确配置 TURN 服务器才能保证 P2P 连通性"
        else
            log_info "系统可能直接连接到公网（无 NAT）"
        fi
    fi
}

# 生成 ICE 配置建议
generate_ice_recommendations() {
    log_test "生成 ICE 配置建议..."
    
    echo ""
    echo "┌─────────────────────────────────────────────────────────────────┐"
    echo "│                      ICE 配置建议                                │"
    echo "└─────────────────────────────────────────────────────────────────┘"
    echo ""
    
    echo "推荐的 STUN 服务器列表:"
    echo "  1. stun:stun.l.google.com:19302  (Google)"
    echo "  2. stun:stun1.l.google.com:19302 (Google)"
    echo "  3. stun:stun2.l.google.com:19302 (Google)"
    echo "  4. stun:stun3.l.google.com:19302 (Google)"
    echo "  5. stun:stun4.l.google.com:19302 (Google)"
    echo "  6. stun:stun.relay.metered.ca:80 (Metered)"
    echo "  7. stun:stun.cloudflare.com:3478 (Cloudflare)"
    echo ""
    
    echo "生产环境配置建议:"
    echo "  ✓ 配置至少 1 个 TURN 服务器"
    echo "  ✓ 使用 TLS 端口 (5349) 而不是明文端口"
    echo "  ✓ 部署多个地理分布的 TURN 服务器"
    echo "  ✓ 启用 ICE 收集超时: 5000ms"
    echo "  ✓ 启用连接超时: 15000ms"
    echo "  ✓ 配置重试机制: 最多 3 次"
    echo ""
    
    echo "P2P CDN 系统配置:"
    echo "  在 server/config.js 中更新 turnServers 配置:"
    echo ""
    echo "  turnServers: ["
    echo "    {"
    echo "      urls: 'turn:$PUBLIC_IP:3478',"
    echo "      username: 'p2pcdn',"
    echo "      credential: 'your_strong_password'"
    echo "    },"
    echo "    {"
    echo "      urls: 'turns:$PUBLIC_IP:5349',"
    echo "      username: 'p2pcdn',"
    echo "      credential: 'your_strong_password'"
    echo "    }"
    echo "  ]"
    echo ""
}

# 主菜单
show_menu() {
    echo ""
    echo "请选择测试项目:"
    echo "  1. 完整诊断（推荐）"
    echo "  2. 仅测试网络配置"
    echo "  3. 仅测试 Coturn 服务"
    echo "  4. 仅检查防火墙"
    echo "  5. 生成配置建议"
    echo "  0. 退出"
    echo ""
    read -p "请输入选项 [0-5]: " choice
    return $choice
}

# 完整诊断
run_full_diagnostic() {
    print_banner
    check_dependencies
    echo ""
    detect_public_ip
    echo ""
    check_firewall
    echo ""
    check_coturn_service
    echo ""
    detect_nat_type
    echo ""
    
    # 测试公共 STUN 服务器
    log_test "测试公共 STUN 服务器..."
    test_stun_server "stun.l.google.com" 19302
    test_stun_server "stun1.l.google.com" 19302
    echo ""
    
    generate_ice_recommendations
    
    echo ""
    log_success "诊断完成！"
}

# 主程序
main() {
    if [ $# -eq 0 ]; then
        # 交互模式
        print_banner
        echo "欢迎使用 P2P CDN ICE 诊断工具"
        echo ""
        
        while true; do
            show_menu
            choice=$?
            
            case $choice in
                1)
                    run_full_diagnostic
                    exit 0
                    ;;
                2)
                    print_banner
                    check_dependencies
                    detect_public_ip
                    detect_nat_type
                    echo ""
                    log_success "网络配置测试完成"
                    ;;
                3)
                    print_banner
                    check_coturn_service
                    ;;
                4)
                    print_banner
                    check_firewall
                    ;;
                5)
                    print_banner
                    detect_public_ip
                    generate_ice_recommendations
                    ;;
                0)
                    log_info "退出"
                    exit 0
                    ;;
                *)
                    log_error "无效选项"
                    ;;
            esac
            echo ""
        done
    else
        # 命令行模式
        case "$1" in
            --full|-f)
                run_full_diagnostic
                ;;
            --network|-n)
                check_dependencies
                detect_public_ip
                detect_nat_type
                ;;
            --service|-s)
                check_coturn_service
                ;;
            --firewall|-fw)
                check_firewall
                ;;
            --recommend|-r)
                detect_public_ip
                generate_ice_recommendations
                ;;
            --help|-h)
                echo "用法: $0 [选项]"
                echo ""
                echo "选项:"
                echo "  -f, --full        完整诊断（默认）"
                echo "  -n, --network     仅测试网络配置"
                echo "  -s, --service     仅测试 Coturn 服务"
                echo "  -fw, --firewall   仅检查防火墙"
                echo "  -r, --recommend   生成配置建议"
                echo "  -h, --help        显示帮助"
                ;;
            *)
                run_full_diagnostic
                ;;
        esac
    fi
}

main "$@"
