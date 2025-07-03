@echo off
echo 🚀 Запуск Cabrio Club Bot Server
echo =================================

echo.
echo 🔍 Проверяем запущенные процессы Node.js...
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo ⚠️  Найдены запущенные процессы Node.js
    echo 🛑 Останавливаем все процессы Node.js...
    taskkill /F /IM node.exe 2>NUL
    timeout /t 2 /nobreak >NUL
    echo ✅ Процессы Node.js остановлены
) else (
    echo ✅ Процессы Node.js не найдены
)

echo.
echo 🔍 Проверяем порт 3001...
netstat -ano | findstr :3001 >NUL
if "%ERRORLEVEL%"=="0" (
    echo ⚠️  Порт 3001 занят
    echo 🛑 Освобождаем порт 3001...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001') do (
        taskkill /F /PID %%a 2>NUL
    )
    timeout /t 2 /nobreak >NUL
    echo ✅ Порт 3001 освобожден
) else (
    echo ✅ Порт 3001 свободен
)

echo.
echo 🚀 Запускаем сервер...
node index.js

pause 