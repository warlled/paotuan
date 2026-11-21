@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node stop.js
goto end

:nonode
echo Node.js was not found. Please install Node.js first.
pause

:end
timeout /t 2 >nul
