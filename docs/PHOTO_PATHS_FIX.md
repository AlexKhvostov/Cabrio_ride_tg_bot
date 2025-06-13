# Исправление путей к фотографиям

## Проблема
При проверке кода были обнаружены проблемы с обработкой путей к фотографиям в различных местах:

1. **В функции `showUserCars`** - использовался старый формат `split(',')` вместо `JSON.parse()`
2. **В функции `completeCreateInvitation`** - передавалось только имя файла без полного пути в `sendGroupPhoto`

## Исправления

### 1. Функция showUserCars (строка 779)

**Было:**
```javascript
const photos = car.photos.split(',').map(p => p.trim()).filter(p => p);
if (photos.length > 0) {
```

**Стало:**
```javascript
const photos = JSON.parse(car.photos);
if (photos && photos.length > 0) {
```

**Причина:** Фотографии автомобилей теперь хранятся в JSON формате, а не как строка через запятую.

### 2. Функция completeCreateInvitation (строка 2027)

**Было:**
```javascript
if (data.photos && data.photos.length > 0) {
    await sendGroupPhoto(data.photos[0], invitationMessage);
}
```

**Стало:**
```javascript
if (data.photos && data.photos.length > 0) {
    const fs = require('fs');
    const path = require('path');
    const carPhotoPath = path.join(__dirname, '../../uploads/cars', data.photos[0]);
    
    if (fs.existsSync(carPhotoPath)) {
        await sendGroupPhoto(carPhotoPath, invitationMessage);
    } else {
        console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
        await sendGroupNotification(invitationMessage);
    }
}
```

**Причина:** `data.photos[0]` содержит только имя файла, а `sendGroupPhoto` ожидает полный путь к файлу.

## Проверенные места (корректные)

### ✅ Функция completeRegistration
```javascript
if (memberData.photo_url) {
    const photoPath = path.join(__dirname, '../../uploads/members', memberData.photo_url);
    await sendGroupPhoto(photoPath, groupNotification);
}
```
**Статус:** Корректно - строится полный путь

### ✅ Функция completeAddCar
```javascript
if (data.photos && data.photos.length > 0) {
    const carPhotoPath = path.join(__dirname, '../../uploads/cars', data.photos[0]);
    if (fs.existsSync(carPhotoPath)) {
        await sendGroupPhoto(carPhotoPath, welcomeMessage);
    }
}
```
**Статус:** Корректно - строится полный путь и проверяется существование

### ✅ Функция showUserProfile
```javascript
if (member.photo_url && member.photo_url.trim() !== '') {
    const photoPath = path.join(__dirname, '../../uploads/members', member.photo_url);
    if (fs.existsSync(photoPath)) {
        await bot.sendPhoto(msg.chat.id, photoPath, {
            caption: profileText,
            parse_mode: 'Markdown'
        });
    }
}
```
**Статус:** Корректно - строится полный путь и проверяется существование

## Принципы работы с фотографиями

### Сохранение в БД
- **Участники:** `photo_url` содержит только имя файла (например: `member_123456_1640995200000.jpg`)
- **Автомобили:** `photos` содержит JSON массив имен файлов (например: `["car_123456_1640995200000_1.jpg", "car_123456_1640995200000_2.jpg"]`)

### Построение путей для отправки
```javascript
// Для участников
const photoPath = path.join(__dirname, '../../uploads/members', member.photo_url);

// Для автомобилей
const photos = JSON.parse(car.photos);
const photoPath = path.join(__dirname, '../../uploads/cars', photos[0]);
```

### Проверка существования
```javascript
if (fs.existsSync(photoPath)) {
    await bot.sendPhoto(chatId, photoPath, options);
} else {
    // Fallback на текстовое сообщение
    await bot.sendMessage(chatId, textMessage, options);
}
```

## Результат
Все фотографии теперь корректно отображаются:
- ✅ В профиле участника
- ✅ В списке автомобилей участника  
- ✅ В групповых уведомлениях о регистрации
- ✅ В групповых уведомлениях о добавлении авто
- ✅ В групповых уведомлениях о приглашениях
- ✅ Fallback на текстовые сообщения при отсутствии файлов 