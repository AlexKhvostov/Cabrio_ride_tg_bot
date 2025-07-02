-- Быстрое обновление статусов автомобилей
-- Выполнить все команды последовательно

-- 1. Нормализация пустых и некорректных статусов
UPDATE cars SET status = 'активный' WHERE status IS NULL OR status = '' OR status = 'не указан';

-- 2. Автомобили без владельца = приглашения  
UPDATE cars SET status = 'приглашение' WHERE member_id IS NULL;

-- 3. Автомобили участников "участник"/"без авто" = на модерации
UPDATE cars c
INNER JOIN members m ON c.member_id = m.id
SET c.status = 'на модерации'
WHERE m.status IN ('участник', 'без авто') AND c.status = 'активный';

-- 4. Автомобили вышедших участников = вышел
UPDATE cars c
INNER JOIN members m ON c.member_id = m.id
SET c.status = 'вышел'
WHERE m.status = 'вышел';

-- Проверка результата
SELECT status, COUNT(*) as count FROM cars GROUP BY status ORDER BY count DESC; 