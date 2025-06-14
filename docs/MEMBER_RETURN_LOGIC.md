# Логика возвращения участников в группу

## Обзор
Когда участник присоединяется к группе, бот проверяет его историю и реагирует соответственно.

## Сценарии обработки

### 1. Возвращение вышедшего участника (статус "вышел")

**Условие:** `existingMember.status === 'вышел'`

**Действия бота:**
1. Восстанавливает статус участника: `"вышел"` → `"активный"`
2. Убирает дату выхода: `left_date = null`
3. Восстанавливает статус автомобилей: `"вышел"` → `"активный"`
4. Подсчитывает количество восстановленных автомобилей
5. Отправляет приветственное сообщение о возвращении

**Сообщение в группу:**
```
🎊 Участник вернулся в клуб!

Иван Петров (@ivan_petrov) снова с нами!

🚗 Восстановлено автомобилей: 2

📊 Статистика обновлена

Добро пожаловать обратно! 🤗
```

### 2. Возвращение зарегистрированного участника (другой статус)

**Условие:** `existingMember && existingMember.status !== 'вышел'`

**Действия бота:**
1. Не изменяет статус участника
2. Отправляет информационное сообщение

**Сообщение в группу:**
```
👋 Участник вернулся в группу

Иван Петров (@ivan_petrov) снова в чате!

Статус в клубе: активный
```

### 3. Новый участник

**Условие:** `!existingMember`

**Действия бота:**
1. Отправляет стандартное приветственное сообщение
2. Предлагает зарегистрироваться

**Сообщение в группу:**
```
🎉 Добро пожаловать в клуб кабриолетов!

Привет, Иван Петров (@ivan_petrov)!

🚗 Рады видеть нового любителя кабриолетов в нашем клубе!

Для начала работы напишите боту @cabrio_club_bot в личные сообщения и используйте команду start

Если есть вопросы - обращайтесь к администраторам! 👋
```

## Технические детали

### Обновление базы данных

**Участник:**
```sql
UPDATE members 
SET status = 'активный', left_date = NULL 
WHERE telegram_id = ?
```

**Автомобили:**
```sql
UPDATE cars 
SET status = 'активный' 
WHERE member_id = ? AND status = 'вышел'
```

### Логирование
```javascript
console.log('🔄 Участник возвращается в клуб:', firstName);
console.log(`🚗 Восстановлен статус автомобиля: ${car.brand} ${car.model} -> "активный"`);
console.log('✅ Уведомление о возвращении отправлено');
```

## Влияние на статистику

### До возвращения:
- Участников в клубе: 23
- Автомобилей в клубе: 28
- Вышло из клуба: 2 участника
- Авто вышедших: 2

### После возвращения:
- Участников в клубе: 24 (+1)
- Автомобилей в клубе: 30 (+2)
- Вышло из клуба: 1 участник (-1)
- Авто вышедших: 0 (-2)

## Обработка ошибок

### Возможные проблемы:
1. **Ошибка обновления БД** - логируется, но не прерывает процесс
2. **Ошибка отправки сообщения** - логируется
3. **Несоответствие данных** - проверка существования записей

### Защитные механизмы:
- Проверка существования участника перед обновлением
- Проверка статуса автомобилей перед восстановлением
- Try-catch блоки для обработки исключений

## Сравнение сообщений

### Выход из группы:
```
😔 Участник покинул клуб

Иван Петров (@ivan_petrov) покинул наш клуб.

🚗 Автомобили участника (2) переведены в статус "вышел"

📊 Статистика обновлена

Надеемся на скорое возвращение! 🤞
```

### Возвращение в группу:
```
🎊 Участник вернулся в клуб!

Иван Петров (@ivan_petrov) снова с нами!

🚗 Восстановлено автомобилей: 2

📊 Статистика обновлена

Добро пожаловать обратно! 🤗
```

## Тестирование

### Сценарий тестирования:
1. Зарегистрировать участника
2. Добавить ему автомобили
3. Удалить из группы (проверить статус "вышел")
4. Добавить обратно в группу
5. Проверить восстановление статусов
6. Проверить обновление статистики

### Ожидаемые результаты:
- Статус участника: "вышел" → "активный"
- Дата выхода: убрана (NULL)
- Статус автомобилей: "вышел" → "активный"
- Сообщение о возвращении отправлено
- Статистика обновлена корректно 