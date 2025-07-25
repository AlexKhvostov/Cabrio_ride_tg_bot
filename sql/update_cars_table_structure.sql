-- Обновление структуры таблицы cars для новых статусов
-- Дата: 2024-12-19

-- ========================================
-- ВАРИАНТ 1: Если поле status имеет тип ENUM
-- ========================================

-- Обновляем ENUM поле с новыми статусами
ALTER TABLE cars 
MODIFY COLUMN status ENUM(
    'активный',
    'на модерации', 
    'приглашение',
    'в клубе',
    'вышел',
    'удален',
    'продан'
) DEFAULT 'активный';

-- ========================================
-- ВАРИАНТ 2: Если поле status имеет тип VARCHAR
-- ========================================

-- Если поле VARCHAR, просто добавляем комментарий с возможными значениями
-- ALTER TABLE cars 
-- MODIFY COLUMN status VARCHAR(50) 
-- COMMENT 'Возможные значения: активный, на модерации, приглашение, в клубе, вышел, удален, продан'
-- DEFAULT 'активный';

-- ========================================
-- ВАРИАНТ 3: Создание нового поля с правильными статусами (если нужно)
-- ========================================

-- Если текущее поле сломано, создаем новое:
-- ALTER TABLE cars ADD COLUMN new_status ENUM(
--     'активный',
--     'на модерации', 
--     'приглашение',
--     'в клубе',
--     'вышел',
--     'удален',
--     'продан'
-- ) DEFAULT 'активный' AFTER status;

-- Копируем данные из старого поля в новое:
-- UPDATE cars SET new_status = 
--     CASE 
--         WHEN status = 'активный' THEN 'активный'
--         WHEN status = 'на модерации' THEN 'на модерации'
--         WHEN status = 'приглашение' THEN 'приглашение'
--         WHEN status = 'в клубе' THEN 'в клубе'
--         WHEN status = 'вышел' THEN 'вышел'
--         WHEN status = 'удален' THEN 'удален'
--         WHEN status = 'продан' THEN 'продан'
--         ELSE 'активный'
--     END;

-- Удаляем старое поле и переименовываем новое:
-- ALTER TABLE cars DROP COLUMN status;
-- ALTER TABLE cars CHANGE new_status status ENUM(
--     'активный',
--     'на модерации', 
--     'приглашение',
--     'в клубе',
--     'вышел',
--     'удален',
--     'продан'
-- ) DEFAULT 'активный';

-- ========================================
-- ПРОВЕРКА РЕЗУЛЬТАТА
-- ========================================

-- Проверяем обновленную структуру
DESCRIBE cars;

-- Проверяем что все статусы корректные
SELECT 
    status,
    COUNT(*) as count
FROM cars 
GROUP BY status 
ORDER BY count DESC;

-- ========================================
-- ДОПОЛНИТЕЛЬНО: Обновление других связанных таблиц
-- ========================================

-- Если есть таблица invitations со статусами, тоже обновляем:
-- ALTER TABLE invitations 
-- MODIFY COLUMN status ENUM(
--     'новое',
--     'ожидание',
--     'вступил в клуб',
--     'отклонено',
--     'удален'
-- ) DEFAULT 'новое';

-- ========================================
-- ФИНАЛЬНАЯ ПРОВЕРКА
-- ========================================

SELECT 'Обновление структуры завершено!' as result;

-- Проверяем что в phpMyAdmin теперь есть правильные варианты в выпадающем списке
SELECT DISTINCT status FROM cars ORDER BY 
    CASE status
        WHEN 'активный' THEN 1
        WHEN 'на модерации' THEN 2
        WHEN 'приглашение' THEN 3
        WHEN 'в клубе' THEN 4
        WHEN 'вышел' THEN 5
        WHEN 'продан' THEN 6
        WHEN 'удален' THEN 7
        ELSE 8
    END; 