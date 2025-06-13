# 🚀 Руководство по деплою на сервер

## 📦 Файлы для переноса на сервер

### ✅ **ОБЯЗАТЕЛЬНЫЕ файлы:**

```
📦 На сервер нужно перенести:
├── 📁 src/                    # Весь исходный код
│   ├── 📁 bot/
│   │   └── bot.js            # ⭐ Основная логика бота
│   ├── 📁 database/
│   │   └── database.js       # ⭐ Работа с БД
│   └── 📁 config/
│       └── config.js         # ⭐ Конфигурация
├── 📁 deploy/                 # Файлы деплоя
│   ├── Procfile              # ⭐ Для Heroku/Railway
│   ├── railway.toml          # ⭐ Для Railway
│   ├── app.js                # ⭐ Альтернативная точка входа
│   └── server.js             # ⭐ Альтернативная точка входа
├── index.js                  # ⭐ Главная точка входа
├── package.json              # ⭐ Зависимости и скрипты
├── package-lock.json         # ⭐ Точные версии пакетов
├── .env                      # ⭐ Переменные окружения
└── .gitignore                # ⭐ Для Git (если используется)
```

### ❌ **НЕ нужно переносить:**

```
📦 НЕ переносить на сервер:
├── 📁 node_modules/          # ❌ Установится через npm install
├── 📁 docs/                  # ❌ Документация (не нужна для работы)
├── 📁 sql/                   # ❌ SQL документация (не нужна для работы)
├── 📁 uploads/               # ❌ Создастся автоматически
├── README.md                 # ❌ Документация
├── env_example.txt           # ❌ Пример (не рабочий файл)
└── .env.test                 # ❌ Уже удален
```

## 🔧 Вопрос о server.js

### **Запустится ли сервер без server.js в корне?**

**✅ ДА, запустится!** Вот почему:

1. **Главная точка входа** - `index.js` (указана в package.json)
2. **Команда запуска** - `npm start` запускает `node index.js`
3. **server.js в deploy/** - это альтернативная точка входа для совместимости

### **Когда нужен server.js в корне:**

- Если хостинг **автоматически** ищет `server.js`
- Если в настройках хостинга указан `server.js` как точка входа
- Для **обратной совместимости** со старыми конфигурациями

### **Решение:**

Можно создать **символическую ссылку** или **копию**:

```bash
# Вариант 1: Копия (рекомендуется)
cp deploy/server.js ./server.js

# Вариант 2: Символическая ссылка (Linux/Mac)
ln -s deploy/server.js ./server.js
```

## 📋 Пошаговый деплой

### 1. **Подготовка файлов**

```bash
# Создать архив с нужными файлами
tar -czf cabrio-bot.tar.gz \
  src/ \
  deploy/ \
  index.js \
  package.json \
  package-lock.json \
  .env
```

### 2. **На сервере**

```bash
# Распаковать
tar -xzf cabrio-bot.tar.gz

# Установить зависимости
npm install --production

# Создать папки для uploads
mkdir -p uploads/members uploads/cars

# Запустить
npm start
```

### 3. **Альтернативные точки входа**

Если хостинг требует определенный файл:

```bash
# Если нужен server.js в корне
cp deploy/server.js ./server.js

# Если нужен app.js в корне  
cp deploy/app.js ./app.js
```

## 🌐 Конфигурация для разных хостингов

### **Heroku**
```bash
# Использует Procfile
# Файлы: Procfile, package.json, index.js
```

### **Railway**
```bash
# Использует railway.toml или package.json
# Файлы: railway.toml, package.json, index.js
```

### **VPS/Обычный сервер**
```bash
# Использует npm start
# Файлы: package.json, index.js
```

### **Хостинги с автопоиском**
```bash
# Могут искать: server.js, app.js, index.js
# Решение: скопировать deploy/server.js в корень
```

## 📁 Минимальный набор файлов

**Абсолютный минимум для работы:**

```
📦 Минимум:
├── src/bot/bot.js           # Логика бота
├── src/database/database.js # База данных  
├── src/config/config.js     # Конфигурация
├── index.js                 # Точка входа
├── package.json             # Зависимости
└── .env                     # Переменные окружения
```

## ⚙️ Переменные окружения (.env)

**Обязательные переменные:**

```env
BOT_TOKEN=your_bot_token_here
CHAT_ID=your_chat_id_here
DB_HOST=your_db_host
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
DB_PORT=3306
```

## 🔍 Проверка после деплоя

```bash
# Проверить структуру
ls -la

# Проверить зависимости
npm list --depth=0

# Проверить конфигурацию
node -e "console.log(require('./src/config/config.js'))"

# Тестовый запуск
npm start
```

## 🚨 Важные моменты

1. **node_modules** - НЕ переносить, установить на сервере
2. **uploads/** - создастся автоматически при первом использовании
3. **.env** - создать на сервере с реальными данными
4. **Права доступа** - убедиться что есть права на запись в uploads/
5. **Node.js версия** - минимум 16.0.0 (указано в package.json)

## 📝 Чек-лист деплоя

- [ ] Перенесены все файлы из списка "ОБЯЗАТЕЛЬНЫЕ"
- [ ] НЕ перенесены файлы из списка "НЕ нужно"
- [ ] Создан .env с реальными данными
- [ ] Выполнен `npm install --production`
- [ ] Созданы папки uploads/members и uploads/cars
- [ ] Проверена версия Node.js (>=16.0.0)
- [ ] Настроена база данных
- [ ] Протестирован запуск через `npm start`

---

**Итог**: Сервер запустится и без server.js в корне, но для совместимости лучше скопировать `deploy/server.js` в корень проекта. 