-- Обновление статусов автомобилей в базе данных
-- Дата: 2024-12-19
-- Описание: Приведение существующих статусов к новой системе

-- ========================================
-- АНАЛИЗ ТЕКУЩИХ СТАТУСОВ
-- ========================================

-- Проверяем текущие статусы автомобилей
SELECT 
    status,
    COUNT(*) as count,
    GROUP_CONCAT(DISTINCT CONCAT(brand, ' ', model) SEPARATOR ', ') as examples
FROM cars 
GROUP BY status 
ORDER BY count DESC;

-- ========================================
-- ОБНОВЛЕНИЕ СТАТУСОВ АВТОМОБИЛЕЙ
-- ========================================

-- 1. Обновляем пустые или NULL статусы на "активный"
UPDATE cars 
SET status = 'активный' 
WHERE status IS NULL OR status = '' OR status = 'не указан';

-- 2. Нормализуем существующие статусы
-- Если есть статусы типа "active", "Активный" и т.д. - приводим к "активный"
UPDATE cars 
SET status = 'активный' 
WHERE LOWER(status) IN ('active', 'активен', 'актив');

-- 3. Обновляем статусы приглашений
-- Если есть статусы типа "invitation", "invite" - приводим к "приглашение"
UPDATE cars 
SET status = 'приглашение' 
WHERE LOWER(status) IN ('invitation', 'invite', 'приглашен', 'пригласили');

-- 4. Обновляем статусы вышедших
-- Если есть статусы типа "left", "inactive" - приводим к "вышел"
UPDATE cars 
SET status = 'вышел' 
WHERE LOWER(status) IN ('left', 'inactive', 'неактивный', 'покинул');

-- ========================================
-- УСТАНОВКА СТАТУСОВ НА ОСНОВЕ ВЛАДЕЛЬЦЕВ
-- ========================================

-- 5. Автомобили без владельца (member_id IS NULL) с пустым статусом - делаем "приглашение"
UPDATE cars 
SET status = 'приглашение' 
WHERE member_id IS NULL AND (status IS NULL OR status = '' OR status = 'активный');

-- 6. Автомобили участников со статусом "участник" или "без авто" - делаем "на модерации"
UPDATE cars c
INNER JOIN members m ON c.member_id = m.id
SET c.status = 'на модерации'
WHERE m.status IN ('участник', 'без авто') 
  AND c.status = 'активный';

-- 7. Автомобили активных участников остаются "активный"
UPDATE cars c
INNER JOIN members m ON c.member_id = m.id
SET c.status = 'активный'
WHERE m.status = 'активный' 
  AND c.status NOT IN ('приглашение', 'в клубе', 'удален');

-- 8. Автомобили вышедших участников - делаем "вышел"
UPDATE cars c
INNER JOIN members m ON c.member_id = m.id
SET c.status = 'вышел'
WHERE m.status = 'вышел';

-- ========================================
-- ПРОВЕРКА РЕЗУЛЬТАТОВ
-- ========================================

-- Проверяем итоговое распределение статусов
SELECT 
    status,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM cars), 2) as percentage
FROM cars 
GROUP BY status 
ORDER BY count DESC;

-- Проверяем автомобили без владельца
SELECT 
    COUNT(*) as cars_without_owner,
    GROUP_CONCAT(DISTINCT status SEPARATOR ', ') as their_statuses
FROM cars 
WHERE member_id IS NULL;

-- Проверяем соответствие статусов автомобилей и их владельцев
SELECT 
    m.status as member_status,
    c.status as car_status,
    COUNT(*) as count
FROM cars c
INNER JOIN members m ON c.member_id = m.id
GROUP BY m.status, c.status
ORDER BY m.status, count DESC;

-- ========================================
-- ВАЛИДАЦИЯ НОВОЙ СИСТЕМЫ СТАТУСОВ
-- ========================================

-- Проверяем, что все статусы соответствуют новой системе
SELECT 
    CASE 
        WHEN status IN ('активный', 'на модерации', 'приглашение', 'в клубе', 'вышел', 'удален', 'продан') 
        THEN 'Корректный' 
        ELSE 'Некорректный' 
    END as status_validity,
    status,
    COUNT(*) as count
FROM cars 
GROUP BY status_validity, status
ORDER BY status_validity, count DESC;

-- Автомобили с некорректными статусами (если есть)
SELECT 
    id, brand, model, year, reg_number, status, member_id
FROM cars 
WHERE status NOT IN ('активный', 'на модерации', 'приглашение', 'в клубе', 'вышел', 'удален', 'продан')
LIMIT 10;

-- ========================================
-- ДОПОЛНИТЕЛЬНЫЕ КОМАНДЫ (ВЫПОЛНЯТЬ ПО НЕОБХОДИМОСТИ)
-- ========================================

-- Если нужно исправить конкретные некорректные статусы:
-- UPDATE cars SET status = 'активный' WHERE status = 'какой-то-неправильный-статус';

-- Если нужно добавить новые поля для отслеживания изменений:
-- ALTER TABLE cars ADD COLUMN status_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
-- ALTER TABLE cars ADD COLUMN status_updated_by VARCHAR(255) DEFAULT 'system_migration';

-- Обновляем поля отслеживания (если добавили выше)
-- UPDATE cars SET status_updated_at = NOW(), status_updated_by = 'system_migration';

-- ========================================
-- ИТОГОВАЯ СТАТИСТИКА
-- ========================================

-- Финальная сводка по статусам
SELECT 
    '=== ИТОГОВАЯ СТАТИСТИКА СТАТУСОВ АВТОМОБИЛЕЙ ===' as summary;

SELECT 
    status,
    COUNT(*) as count,
    CASE 
        WHEN status = 'активный' THEN 'Автомобили участвуют в встречах'
        WHEN status = 'на модерации' THEN 'Ожидают одобрения админов'
        WHEN status = 'приглашение' THEN 'Созданы через систему приглашений'
        WHEN status = 'в клубе' THEN 'Бывшие приглашения, ставшие реальными'
        WHEN status = 'вышел' THEN 'Владельцы покинули клуб'
        WHEN status = 'удален' THEN 'Удалены администраторами'
        WHEN status = 'продан' THEN 'Проданы владельцами'
        ELSE 'Неизвестный статус'
    END as description
FROM cars 
GROUP BY status 
ORDER BY 
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

-- Проверка целостности данных
SELECT 
    'Проверка целостности:' as check_type,
    CASE 
        WHEN COUNT(*) = 0 THEN 'OK - Нет автомобилей с некорректными статусами'
        ELSE CONCAT('ВНИМАНИЕ - ', COUNT(*), ' автомобилей с некорректными статусами')
    END as result
FROM cars 
WHERE status NOT IN ('активный', 'на модерации', 'приглашение', 'в клубе', 'вышел', 'удален', 'продан');

SELECT 
    'Всего автомобилей в системе:' as info,
    COUNT(*) as total_cars
FROM cars;

SELECT 
    'Автомобилей в поиске (активный, приглашение, на модерации):' as info,
    COUNT(*) as searchable_cars
FROM cars 
WHERE status IN ('активный', 'приглашение', 'на модерации'); 