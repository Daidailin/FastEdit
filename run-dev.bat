@echo off
chcp 65001 >nul
title FastEdit 开发模式

echo ======================================
echo   FastEdit 开发模式
echo ======================================
echo.

REM 检查 node_modules
if not exist "node_modules" (
    echo [提示] 未找到依赖，正在安装...
    npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [错误] 依赖安装失败！
        pause
        exit /b 1
    )
)

echo 启动开发服务器...
echo 按 Ctrl+C 停止
echo.

npm start

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [错误] 启动失败！
    pause
)
