@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 遗忘者归乡论坛

echo ========================================
echo   遗忘者归乡论坛 启动中...
echo ========================================
echo.

if not exist "node_modules" (
    echo [!] 未检测到依赖, 正在安装...
    call npm install
    echo.
)

echo 论坛地址: http://localhost:3000
echo 默认管理员: admin / admin123
echo.
echo 启动后请在浏览器打开上面的地址, 关闭本窗口即停止服务。
echo ----------------------------------------
echo.

start "" http://localhost:3000
node app.js

pause
