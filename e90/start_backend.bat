@echo off
REM 启动后端服务
cd /d "%~dp0backend"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
