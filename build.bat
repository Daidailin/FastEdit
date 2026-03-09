@echo off
chcp 65001 >nul
title FastEdit 构建工具

echo ======================================
echo   FastEdit 大文件文本编辑器
echo   构建工具
echo ======================================
echo.

REM 检查 Node.js
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/4] Node.js 版本:
node --version
echo.

REM 检查 npm
npm --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [错误] npm 未正确安装
    pause
    exit /b 1
)

echo [2/4] npm 版本:
npm --version
echo.

REM 安装依赖
echo [3/4] 正在安装依赖...
echo 这可能需要几分钟时间，请耐心等待...
echo.

npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [错误] 依赖安装失败！
    echo 请检查网络连接或尝试使用管理员权限运行
    pause
    exit /b 1
)

echo.
echo [4/4] 正在构建便携版...
echo.

npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [错误] 构建失败！
    pause
    exit /b 1
)

echo.
echo ======================================
echo   构建成功！
echo ======================================
echo.
echo 可执行文件位置:
echo   dist\FastEdit-Portable.exe
echo.
echo 直接运行即可，无需安装
echo.
pause
