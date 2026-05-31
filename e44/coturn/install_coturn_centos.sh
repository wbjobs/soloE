#!/bin/bash
# ==============================================================================
# P2P CDN 系统 Coturn TURN 服务器自动安装脚本（CentOS/RHEL）
# ==============================================================================

set -e  # 遇到错误立即退出

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用 root 用户或 sudo 运行此脚本"
        exit 1
    fi
}

# 检测系统版本
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
    else
        OS=$(uname -s)
        VER=$(uname -r)
    fi
    log_info "检测到操作系统: $OS $VER"
}

# 配置防火墙
configure_firewall() {
    log_info "配置防火墙规则..."
    
    if command -v firewall-cmd &> /dev/null; then
        # firewalld (CentOS/RHEL)
        log_info "检测到 firewalld"
        
        firewall-cmd --permanent --add-port=3478/udp
        firewall-cmd --permanent --add-port=3478/tcp
        firewall-cmd --permanent --add-port=5349/tcp
        firewall-cmd --permanent --add-port=49152-65535/udp
        firewall-cmd --reload
        
        log_success "防火墙规则已添加"
    elif command -v iptables &> /dev/null; then
        # iptables
        log_info "检测到 iptables"
        
        iptables -A INPUT -p udp --dport 3478 -j ACCEPT
        iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
        iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
        iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT
        
        # 保存规则
        if command -v iptables-save &> /dev/null; then
            service iptables save 2>/dev/null || true
        fi
        
        log_success "防火墙规则已添加"
    else
        log_warning "未检测到防火墙，请手动配置防火墙规则"
    fi
}

# 配置系统参数
configure_sysctl() {
    log_info "优化系统网络参数..."
    
    cat >> /etc/sysctl.conf << 'EOF'

# P2P CDN Coturn 优化配置
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
net.core.netdev_max_backlog = 30000
net.ipv4.ip_local_port_range = 49152 65535
fs.file-max = 100000
EOF

    sysctl -p
    log_success "系统参数已优化"
}

# 创建 turnserver 用户
create_turnserver_user() {
    if ! id "turnserver" &>/dev/null; then
        log_info "创建 turnserver 用户..."
        useradd -r -s /bin/false turnserver
        log_success "用户已创建"
    fi
}

# 主安装流程
main() {
    log_info "=============================================="
    log_info "P2P CDN Coturn TURN 服务器安装脚本（CentOS/RHEL）"
    log_info "=============================================="
    
    # 预安装检查
    check_root
    detect_os
    
    # 1. 安装 EPEL 仓库
    echo ""
    log_info "步骤 1/9: 安装 EPEL 仓库..."
    yum install -y epel-release
    log_success "EPEL 仓库已安装"
    
    # 2. 更新系统
    echo ""
    log_info "步骤 2/9: 更新系统软件包..."
    yum update -y
    log_success "系统已更新"
    
    # 3. 安装依赖
    echo ""
    log_info "步骤 3/9: 安装依赖软件包..."
    yum install -y coturn net-tools curl wget openssl
    log_success "依赖安装完成"
    
    # 4. 创建用户
    echo ""
    log_info "步骤 4/9: 创建服务用户..."
    create_turnserver_user
    
    # 5. 获取公网 IP
    echo ""
    log_info "步骤 5/9: 检测公网 IP..."
    PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me)
    
    if [ -z "$PUBLIC_IP" ]; then
        log_error "无法检测公网 IP，请手动配置"
    else
        log_success "检测到公网 IP: $PUBLIC_IP"
    fi
    
    # 6. 生成随机密码
    echo ""
    log_info "步骤 6/9: 生成安全密码..."
    TURN_PASSWORD=$(openssl rand -hex 16)
    log_success "生成的密码: $TURN_PASSWORD"
    log_warning "请保存此密码，配置 P2P CDN 时需要使用"
    
    # 7. 创建目录和配置
    echo ""
    log_info "步骤 7/9: 创建配置文件..."
    mkdir -p /var/log/turnserver
    mkdir -p /run/turnserver
    chown -R turnserver:turnserver /var/log/turnserver
    chown -R turnserver:turnserver /run/turnserver
    
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    if [ -f "$SCRIPT_DIR/coturn.conf" ]; then
        cp "$SCRIPT_DIR/coturn.conf" /etc/coturn/turnserver.conf
    else
        log_warning "未找到配置文件，使用默认配置作为基础"
        if [ -f /etc/coturn/turnserver.conf ]; then
            cp /etc/coturn/turnserver.conf /etc/coturn/turnserver.conf.bak
        fi
    fi
    
    # 更新配置文件
    CONFIG_FILE="/etc/coturn/turnserver.conf"
    if [ ! -f "$CONFIG_FILE" ]; then
        CONFIG_FILE="/etc/turnserver.conf"
    fi
    
    if [ -f "$CONFIG_FILE" ]; then
        if [ -n "$PUBLIC_IP" ]; then
            sed -i "s/external-ip=YOUR_PUBLIC_IP_ADDRESS/external-ip=$PUBLIC_IP/g" "$CONFIG_FILE"
        fi
        sed -i "s/user=p2pcdn:p2pcdn123/user=p2pcdn:$TURN_PASSWORD/g" "$CONFIG_FILE"
        sed -i "s/no-auth/# no-auth/g" "$CONFIG_FILE"
        log_success "配置文件已更新"
    else
        log_error "未找到配置文件"
    fi
    
    # 8. 配置防火墙
    echo ""
    log_info "步骤 8/9: 配置防火墙..."
    configure_firewall
    
    # 9. 配置系统参数
    echo ""
    log_info "步骤 9/9: 优化系统参数..."
    configure_sysctl
    
    # 启动服务
    echo ""
    log_info "启动 Coturn 服务..."
    
    # 创建 systemd 服务
    cat > /etc/systemd/system/coturn.service << 'EOF'
[Unit]
Description=Coturn TURN Server
After=network.target

[Service]
Type=forking
PIDFile=/run/turnserver/turnserver.pid
ExecStart=/usr/bin/turnserver -c /etc/coturn/turnserver.conf
Restart=always
RestartSec=10
User=turnserver
Group=turnserver

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable coturn
    systemctl start coturn
    
    # 等待服务启动
    sleep 3
    
    # 检查服务状态
    if systemctl is-active --quiet coturn; then
        log_success "Coturn 服务已成功启动！"
    else
        log_error "Coturn 服务启动失败，请检查日志"
        journalctl -u coturn --no-pager -n 20
        exit 1
    fi
    
    # 显示安装总结
    echo ""
    echo ""
    log_info "=============================================="
    log_success "安装完成！"
    log_info "=============================================="
    echo ""
    echo "TURN 服务器配置信息："
    echo "----------------------------------------------"
    echo "公网 IP:     $PUBLIC_IP"
    echo "监听端口:    3478 (UDP/TCP)"
    echo "TLS 端口:    5349 (TCP)"
    echo "用户名:      p2pcdn"
    echo "密码:        $TURN_PASSWORD"
    echo ""
    echo "P2P CDN 配置："
    echo "----------------------------------------------"
    echo "在 server/config.js 中更新 turnServers 配置："
    echo ""
    echo "turnServers: ["
    echo "  {"
    echo "    urls: 'turn:$PUBLIC_IP:3478',"
    echo "    username: 'p2pcdn',"
    echo "    credential: '$TURN_PASSWORD'"
    echo "  }"
    echo "]"
    echo ""
    echo "验证方法："
    echo "----------------------------------------------"
    echo "1. 检查端口监听: netstat -tulpn | grep turnserver"
    echo "2. 查看日志:     tail -f /var/log/turnserver/turnserver.log"
    echo "3. 测试服务:     systemctl status coturn"
    echo "4. Web 测试:     https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
    echo ""
    echo "下一步操作："
    echo "----------------------------------------------"
    echo "1. 配置 TLS 证书（生产环境必须）"
    echo "2. 更新 P2P CDN 服务端配置"
    echo "3. 测试 P2P 连接成功率"
    echo ""
    log_warning "重要：请保存好密码 $TURN_PASSWORD"
}

# 运行主函数
main "$@"
