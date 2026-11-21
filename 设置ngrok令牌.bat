@echo off
cd /d "%~dp0"
echo.
echo 正在打开 ngrok 令牌页面，登录后点 Copy 复制 Authtoken
start "" "https://dashboard.ngrok.com/get-started/your-authtoken"
echo.
set /p TOKEN=把 Authtoken 粘贴到这里后按回车：
if "%TOKEN%"=="" goto empty
bin\ngrok.exe config add-authtoken %TOKEN%
if errorlevel 1 goto fail
echo.
echo 令牌已保存。接下来双击「固定域名.bat」。
pause
goto end

:empty
echo 没有输入内容。
pause
goto end

:fail
echo 保存失败，请检查令牌是否复制完整。
pause

:end
