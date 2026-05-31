@echo off
echo ========================================
echo  会议录音分析工具 - 启动脚本
echo ========================================
echo.

cd /d "%~dp0backend"

echo [1/3] 检查 Python 环境...
python --version
if %errorlevel% neq 0 (
    echo 错误: 未找到 Python，请先安装 Python 3.9+
    pause
    exit /b 1
)

echo.
echo [2/3] 检查依赖...
if not exist "venv" (
    echo 创建虚拟环境...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo 安装依赖...
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

echo.
echo [3/3] 启动服务...
echo.
echo 服务启动后，请在浏览器访问: http://localhost:8000
echo 按 Ctrl+C 停止服务
echo.

python main.py

pause
