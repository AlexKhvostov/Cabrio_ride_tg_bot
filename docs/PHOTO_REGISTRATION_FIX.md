# Исправление проблем с фотографиями при регистрации

## Проблемы

### 1. Лишнее сообщение после загрузки фото
**Проблема:** После успешной загрузки фото появлялось сообщение "Пожалуйста, отправьте фотографию или нажмите /skip"

**Причина:** Логика в `handleRegistration` обрабатывала любое сообщение (включая фото) как текст

**Решение:** Добавлена проверка `msg.text` - сообщение появляется только если пользователь ввел текст вместо фото

### 2. Фото не отправляется в группу при регистрации
**Проблема:** При завершении регистрации фото профиля не отправлялось в группу

**Причина:** Неправильный путь к файлу фото - передавался относительный путь вместо полного

**Решение:** Построение полного пути к файлу перед отправкой в группу

## Исправления в коде

### 1. Логика обработки фото в регистрации

**Было:**
```javascript
case 'photo':
    if (msg.text && msg.text.trim() === '/skip') {
        await completeRegistration(msg, userId, data);
    } else {
        // Ждём фото (обрабатывается в handlePhotoRegistration)
        bot.sendMessage(msg.chat.id, 
            '📸 Пожалуйста, отправьте фотографию или нажмите /skip'
        );
    }
    break;
```

**Стало:**
```javascript
case 'photo':
    if (msg.text && msg.text.trim() === '/skip') {
        // Пропускаем фото
        await completeRegistration(msg, userId, data);
    } else if (msg.text) {
        // Пользователь ввел текст вместо фото
        bot.sendMessage(msg.chat.id, 
            '📸 Пожалуйста, отправьте фотографию или нажмите /skip'
        );
    }
    // Если это фото - оно обрабатывается в handlePhotoRegistration
    break;
```

### 2. Сохранение имени файла вместо пути

**Было:**
```javascript
// Сохраняем путь к фото в данных пользователя
const data = userState.data || {};
data.photo_url = photoPath;
```

**Стало:**
```javascript
// Сохраняем только имя файла в данных пользователя
const data = userState.data || {};
data.photo_url = fileName;
```

### 3. Построение полного пути для отправки в группу

**Было:**
```javascript
// Отправляем фото профиля если есть
if (memberData.photo_url) {
    await sendGroupPhoto(memberData.photo_url, groupNotification);
} else {
    await sendGroupNotification(groupNotification);
}
```

**Стало:**
```javascript
// Отправляем фото профиля если есть
if (memberData.photo_url) {
    const fs = require('fs');
    const path = require('path');
    const photoPath = path.join(__dirname, '../../uploads/members', memberData.photo_url);
    
    if (fs.existsSync(photoPath)) {
        await sendGroupPhoto(photoPath, groupNotification);
    } else {
        console.log('⚠️ Файл фото профиля не найден:', photoPath);
        await sendGroupNotification(groupNotification);
    }
} else {
    await sendGroupNotification(groupNotification);
}
```

## Логика работы после исправлений

### Сценарий 1: Пользователь загружает фото
1. Пользователь отправляет фото
2. Срабатывает `handlePhotoRegistration`
3. Фото сохраняется, имя файла записывается в `data.photo_url`
4. Вызывается `completeRegistration`
5. Строится полный путь к файлу
6. Фото отправляется в группу с информацией о регистрации

### Сценарий 2: Пользователь вводит текст вместо фото
1. Пользователь отправляет текст
2. Срабатывает `handleRegistration` с проверкой `msg.text`
3. Отправляется сообщение "Пожалуйста, отправьте фотографию или нажмите /skip"

### Сценарий 3: Пользователь пропускает фото
1. Пользователь отправляет `/skip`
2. Срабатывает `handleRegistration`
3. Вызывается `completeRegistration` без фото
4. В группу отправляется только текстовое уведомление

## Структура файлов

### Сохранение фото:
- **Полный путь:** `/uploads/members/member_123456789_1234567890.jpg`
- **В БД:** `member_123456789_1234567890.jpg` (только имя файла)

### Отправка в группу:
- **Построение пути:** `path.join(__dirname, '../../uploads/members', fileName)`
- **Проверка существования:** `fs.existsSync(photoPath)`
- **Fallback:** текстовое сообщение если файл не найден

## Тестирование

### Проверить:
1. ✅ Загрузка фото при регистрации
2. ✅ Отсутствие лишних сообщений после загрузки фото
3. ✅ Отправка фото в группу при завершении регистрации
4. ✅ Обработка ввода текста вместо фото
5. ✅ Пропуск фото командой `/skip`
6. ✅ Fallback на текстовое сообщение при отсутствии файла

### Ожидаемые результаты:
- Фото загружается без лишних сообщений
- При регистрации с фото - в группу отправляется фото с подписью
- При регистрации без фото - в группу отправляется только текст
- Корректная обработка всех сценариев пользователя 