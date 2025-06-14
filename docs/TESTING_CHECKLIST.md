# 🧪 Чек-лист для тестирования исправлений

## 📷 Тестирование фотографий

### ✅ Профиль участника (`/profile`)
- [ ] Участник с фото - отображается фото + информация
- [ ] Участник без фото - отображается только текстовая информация
- [ ] Несуществующий файл фото - fallback на текст

### ✅ Автомобили участника (`/cars`)
- [ ] Автомобиль с одним фото - отображается фото + информация
- [ ] Автомобиль с несколькими фото - отображается первое фото + счетчик "Фото: 1 из X"
- [ ] Автомобиль без фото - отображается только текстовая информация
- [ ] Несуществующий файл фото - fallback на текст

### ✅ Групповые уведомления
- [ ] Регистрация с фото - фото профиля в группе
- [ ] Регистрация без фото - только текстовое сообщение
- [ ] Добавление авто с фото - фото автомобиля в группе
- [ ] Добавление авто без фото - только текстовое сообщение
- [ ] Приглашение с фото - фото приглашенного авто в группе
- [ ] Приглашение без фото - только текстовое сообщение

## 🚪 Тестирование выхода/возвращения

### ✅ Выход из группы
- [ ] Участник покидает группу - статус меняется на "вышел"
- [ ] Автомобили участника - статус меняется на "вышел"
- [ ] Сообщение в группе - "😔 Участник покинул клуб..."
- [ ] Статистика обновляется - исключается из активных

### ✅ Возвращение в группу
- [ ] **Новый участник** - стандартное приветствие
- [ ] **Вернувшийся участник** - "🎊 Участник вернулся в клуб!"
- [ ] Статус восстанавливается на "активный"
- [ ] Автомобили восстанавливаются на "активный"
- [ ] Статистика обновляется - добавляется к активным
- [ ] **Существующий участник** - "👋 Участник вернулся в группу"

## 📊 Тестирование статистики

### ✅ Команда `/stats`
- [ ] Показывает только активных участников
- [ ] Показывает только активные автомобили
- [ ] Показывает количество вышедших участников
- [ ] Показывает количество авто вышедших
- [ ] Корректно пересчитывается при выходе/возвращении

## 🔍 Тестирование поиска

### ✅ Поиск по номеру (`/search`)
- [ ] Находит активные автомобили
- [ ] Находит автомобили вышедших участников
- [ ] Находит приглашения
- [ ] Показывает количество фотографий (не сами фото)
- [ ] Корректно отображает статус

## 📝 Тестирование регистрации

### ✅ Процесс регистрации
- [ ] Регистрация с фото профиля
- [ ] Регистрация без фото профиля (`/skip`)
- [ ] Белорусский номер телефона в примере: `+375 (33) 993-22-88`
- [ ] Сообщение "Пожалуйста, отправьте фотографию" появляется только при вводе текста
- [ ] Фото корректно сохраняется и отправляется в группу

### ✅ Добавление автомобиля
- [ ] Добавление с фотографиями
- [ ] Добавление без фотографий (`/skip`)
- [ ] Множественные фото - корректное сохранение
- [ ] Фото корректно отправляется в группу

### ✅ Создание приглашения
- [ ] Приглашение с фотографиями
- [ ] Приглашение без фотографий (`/skip`)
- [ ] Фото корректно отправляется в группу

## 🔧 Технические проверки

### ✅ Логи и ошибки
- [ ] Нет ошибок в консоли при работе с фото
- [ ] Корректные пути к файлам в логах
- [ ] Fallback срабатывает при отсутствии файлов

### ✅ База данных
- [ ] Поле `left_date` добавлено в таблицу `members`
- [ ] Статус "вышел" добавлен в ENUM для `cars`
- [ ] Индекс `idx_members_left_date` создан

### ✅ Файловая система
- [ ] Директории `uploads/members/` и `uploads/cars/` создаются
- [ ] Фото сохраняются с корректными именами
- [ ] В БД сохраняются только имена файлов (не полные пути)

## 🎯 Критические сценарии

### ✅ Стресс-тесты
- [ ] Множественные выходы/возвращения подряд
- [ ] Регистрация с большими фотографиями
- [ ] Одновременная работа нескольких пользователей
- [ ] Работа при отсутствии интернета (graceful degradation)

### ✅ Граничные случаи
- [ ] Участник выходит и сразу возвращается
- [ ] Удаление файлов фото во время работы бота
- [ ] Некорректные данные в поле `photos` (не JSON)
- [ ] Пустые массивы фотографий

## 📋 Результат тестирования

После прохождения всех пунктов чек-листа:
- [ ] **Все функции работают корректно**
- [ ] **Фотографии отображаются везде**
- [ ] **Статистика точная**
- [ ] **Нет критических ошибок**
- [ ] **Готово к продакшену** 🚀

---

**Примечание:** Рекомендуется тестировать на тестовой группе перед деплоем в продакшен. 