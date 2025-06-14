# 🎯 Система приглашений - Руководство

## 📋 Описание системы

Система приглашений позволяет участникам клуба фиксировать случаи, когда они оставляют визитки в незнакомых кабриолетах. Это помогает:

- **Отслеживать активность** участников по привлечению новых членов
- **Вести статистику** по приглашениям
- **Находить автомобили** по номерам для повторных контактов
- **Анализировать эффективность** приглашений

## 🎯 Философия системы

**Главный принцип:** Номер автомобиля - это основной идентификатор. Не все участники разбираются в марках и моделях, но номер может увидеть каждый.

**Приоритеты полей:**
1. **🔢 Номер** - обязательно (главный идентификатор)
2. **📸 Фото** - желательно (визуальная идентификация)
3. **📍 Место** - необязательно (где искать владельца)
4. **🚗 Марка/модель** - необязательно (только если точно знаете)
5. **📱 Контакты** - необязательно (что оставили в визитке)
6. **📝 Заметки** - необязательно (дополнительная информация)

## 🚀 Как использовать

### 1. Создание приглашения

Когда вы видите незнакомый кабриолет и оставляете визитку:

1. **Нажмите** "🎯 Оставить приглашение" в главном меню
2. **Введите данные** автомобиля поэтапно:

**Обязательные поля:**
   - ✅ Регистрационный номер (главный идентификатор)

**Желательные поля:**
   - 📸 Фотографии автомобиля (настоятельно рекомендуется)

**Необязательные поля:**
   - 📍 Место где оставили визитку
   - 🚗 Марка (BMW, Mercedes-Benz, Audi и т.д.)
   - 🚗 Модель (E46, SLK, A4 и т.д.)
   - 📱 Контактная информация которую оставили
   - 📝 Дополнительные заметки

**Команды управления:**
   - `/skip` - пропустить текущий вопрос
   - `/done` - завершить загрузку фотографий
   - `/finish` - завершить приглашение досрочно (доступно с 3-го этапа)

### 2. Просмотр своих приглашений

- **Команда:** "📮 Мои приглашения"
- **Показывает:** все ваши приглашения с датами и статусами
- **Статистика:** количество по каждому статусу

### 3. Поиск по номерам

- **Команда:** "🔍 Поиск по номеру"
- **Возможности:**
  - Полный номер: `A123BC77`
  - Частичный поиск: `A123`, `BC77`, `123`
  - Поиск не чувствителен к регистру

## 📊 Статусы приглашений

| Статус | Описание |
|--------|----------|
| `новое` | Только что созданное приглашение |
| `контакт` | Владелец автомобиля откликнулся |
| `встреча` | Назначена встреча с владельцем |
| `вступил в клуб` | Владелец стал участником клуба |
| `отказ` | Владелец отказался от участия |
| `нет ответа` | Владелец не отвечает длительное время |

## 🛡️ Защита от ошибок

### Проверка автомобилей участников
Система автоматически проверяет, не принадлежит ли автомобиль участнику клуба:

- **Если номер принадлежит участнику** → показывает информацию о владельце
- **Блокирует создание приглашения** → предлагает связаться через клуб
- **Показывает данные владельца** → имя, статус, фото автомобиля

### Проверка дубликатов приглашений
- **Если номер уже в приглашениях** → показывает статистику
- **Предлагает выбор** → продолжить или отменить
- **Показывает историю** → последние приглашения

## 🔍 Поиск и фильтрация

### Поиск по номеру
```
Примеры поисковых запросов:
• A123BC77 - точное совпадение
• A123 - все номера содержащие A123
• 77 - все номера с регионом 77
• BC - все номера содержащие BC
```

### Результаты поиска показывают:
- **Марка и модель** автомобиля
- **Год выпуска** (если указан)
- **Регистрационный номер**
- **Статус** автомобиля
- **Количество фотографий** автомобиля
- **Количество приглашений** для данного авто
- **Последнее приглашение** (дата и место)

## 🎯 Типы автомобилей в системе

### Автомобили участников
- **Статус:** `активный`, `продан`, `на ремонте`
- **Владелец:** указан участник клуба
- **Использование:** для профилей участников

### Автомобили для приглашений
- **Статус:** `приглашение`
- **Владелец:** не указан (NULL)
- **Использование:** для фиксации визиток

## 📈 Статистика и аналитика

Система автоматически ведет статистику:

- **Общее количество** приглашений
- **Распределение по статусам**
- **Активность участников** по приглашениям
- **Эффективность** (сколько приглашений привело к вступлению)

## 🔧 Технические особенности

### Валидация номеров
- **Формат:** только латинские буквы (A-Z) и цифры (0-9)
- **Длина:** от 4 до 12 символов
- **Без пробелов** и специальных символов
- **Автоматическое приведение** к верхнему регистру

### Хранение данных
- **Автомобили:** таблица `cars`
- **Приглашения:** таблица `invitations`
- **Фотографии:** локально в `uploads/cars/` (путь в БД как JSON)
- **Связи:** через `car_id` и `inviter_member_id`

### Поиск
- **Частичное совпадение** через SQL LIKE
- **Регистронезависимый** поиск
- **Сортировка** по дате создания (новые первые)

## 💡 Советы по использованию

### Для участников:
1. **Всегда фиксируйте** оставленные визитки
2. **Обязательно указывайте номер** - это главный идентификатор
3. **Фотографируйте автомобиль** - это очень поможет при поиске
4. **Используйте /finish** для быстрого завершения
5. **Марку/модель указывайте** только если точно знаете
6. **Обновляйте статус** при получении ответа

### Для администраторов:
1. **Отслеживайте статистику** приглашений
2. **Поощряйте активных** участников
3. **Анализируйте эффективность** разных подходов
4. **Ведите учет** успешных приглашений

## 📸 Работа с фотографиями

### Загрузка фотографий
- **Формат:** JPG (автоматическое сжатие Telegram)
- **Количество:** неограниченно
- **Размер:** до 20 МБ на фото
- **Команды:** `/done` для завершения загрузки, `/skip` для пропуска всех фото

### Хранение фотографий
- **Путь:** `D:\_P_R_O_J_E_C_T\cabrio\dev\tg_bot\uploads\cars\`
- **Имена файлов:** `invitation_[userId]_[timestamp]_[номер].jpg`
- **База данных:** пути сохраняются как JSON в поле `photos`

### Советы по фотографированию
1. **Снимайте общий вид** автомобиля
2. **Фокусируйтесь на номере** если он виден
3. **Показывайте характерные детали** (решетка, фары, диски)
4. **Избегайте личных данных** владельца в кадре

## 🚨 Важные моменты

- **Проверка номеров:** система автоматически проверяет принадлежность автомобилей
- **Участники клуба:** нельзя создавать приглашения для автомобилей участников
- **Конфиденциальность:** не указывайте личные данные владельцев
- **Точность:** проверяйте правильность номеров
- **Актуальность:** обновляйте статусы приглашений
- **Этичность:** уважайте решение владельцев автомобилей
- **Фотографии:** не снимайте людей без разрешения

## 📞 Поддержка

При возникновении проблем с системой приглашений:
1. Проверьте правильность ввода данных
2. Убедитесь в корректности номера
3. Обратитесь к администратору через /help

---

*Система приглашений помогает расширять клуб и находить единомышленников среди владельцев кабриолетов! 🚗💨* 