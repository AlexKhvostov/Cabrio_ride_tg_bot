# Cabrio Club Telegram Bot - Deploy Package

## Быстрый старт

1. Установить зависимости:
   ```bash
   npm install --production
   ```

2. Создать папки для uploads:
   ```bash
   mkdir -p uploads/members uploads/cars
   ```

3. Проверить .env файл (должен содержать реальные данные)

4. Запустить:
   ```bash
   npm start
   ```

## Альтернативные точки входа

- `node index.js` - основная точка входа
- `node server.js` - для совместимости
- `node app.js` - для совместимости

## Требования

- Node.js >= 16.0.0
- MySQL база данных
- Доступ к Telegram Bot API

Создано: 13.06.2025, 17:18:59
