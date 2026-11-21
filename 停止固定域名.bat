@echo off
cd /d "%~dp0"
if exist work\fixed.pid goto killfix
goto killngrok

:killfix
set /p FIXPID=<work\fixed.pid
taskkill /PID %FIXPID% /F >nul 2>nul
del work\fixed.pid >nul 2>nul

:killngrok
if not exist work\ngrok.pid goto done
set /p NGID=<work\ngrok.pid
taskkill /PID %NGID% /F >nul 2>nul
del work\ngrok.pid >nul 2>nul

:done
echo ÒÑÍ£Ö¹¹Ì¶¨ÓòÃû¡£
timeout /t 2 >nul
