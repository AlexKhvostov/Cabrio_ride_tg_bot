# Запуск Cabrio Club Bot Server
Write-Host "=== Запуск Cabrio Club Bot Server ===" -ForegroundColor Green

Write-Host ""
Write-Host "Проверяем запущенные процессы Node.js..." -ForegroundColor Yellow

# Проверяем процессы Node.js
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue

if ($nodeProcesses) {
    Write-Host "[WARNING] Найдены запущенные процессы Node.js:" -ForegroundColor Yellow
    $nodeProcesses | ForEach-Object { Write-Host "   PID: $($_.Id), CPU: $($_.CPU)" }
    
    Write-Host "[ACTION] Останавливаем все процессы Node.js..." -ForegroundColor Red
    Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "[OK] Процессы Node.js остановлены" -ForegroundColor Green
} else {
    Write-Host "[OK] Процессы Node.js не найдены" -ForegroundColor Green
}

Write-Host ""
Write-Host "Проверяем порт 3001..." -ForegroundColor Yellow

# Проверяем порт 3001
$port3001 = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue

if ($port3001) {
    Write-Host "[WARNING] Порт 3001 занят процессом PID: $($port3001.OwningProcess)" -ForegroundColor Yellow
    Write-Host "[ACTION] Освобождаем порт 3001..." -ForegroundColor Red
    
    $port3001 | ForEach-Object {
        try {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host "   Остановлен процесс PID: $($_.OwningProcess)" -ForegroundColor Yellow
        } catch {
            Write-Host "   Не удалось остановить процесс PID: $($_.OwningProcess)" -ForegroundColor Red
        }
    }
    
    Start-Sleep -Seconds 2
    Write-Host "[OK] Порт 3001 освобожден" -ForegroundColor Green
} else {
    Write-Host "[OK] Порт 3001 свободен" -ForegroundColor Green
}

Write-Host ""
Write-Host "Запускаем сервер..." -ForegroundColor Green
Write-Host ""

# Запускаем сервер
try {
    node index.js
} catch {
    Write-Host "[ERROR] Ошибка запуска сервера: $($_.Exception.Message)" -ForegroundColor Red
} 