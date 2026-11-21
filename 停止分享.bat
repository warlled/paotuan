@echo off
cd /d "%~dp0"
if exist work\share.pid goto killshare
goto killcf

:killshare
set /p SHAREPID=<work\share.pid
taskkill /PID %SHAREPID% /F >nul 2>nul
del work\share.pid >nul 2>nul

:killcf
if not exist work\cloudflared.pid goto done
set /p CFPID=<work\cloudflared.pid
taskkill /PID %CFPID% /F >nul 2>nul
del work\cloudflared.pid >nul 2>nul

:done
echo ÒÑÍ£Ö¹¹«Íø·ÖÏí¡£
timeout /t 2 >nul
