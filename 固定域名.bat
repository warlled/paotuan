@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
title 跑团固定域名 - 关掉窗口即停止
node fixed-link.js
echo.
pause
goto end

:nonode
echo Node.js was not found.
pause

:end
