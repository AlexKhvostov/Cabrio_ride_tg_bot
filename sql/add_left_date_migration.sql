-- Миграция: добавление поля left_date и обновление статусов
-- Дата создания: 2024

-- Добавляем поле left_date в таблицу members
ALTER TABLE members 
ADD COLUMN left_date DATE NULL COMMENT 'Дата выхода из клуба' 
AFTER join_date;

-- Обновляем ENUM для статуса автомобилей, добавляем "вышел"
ALTER TABLE cars 
MODIFY COLUMN status ENUM('активный', 'продан', 'в ремонте', 'разбит', 'приглашение', 'вышел') DEFAULT 'активный';

-- Добавляем индекс для поля left_date для оптимизации запросов
CREATE INDEX idx_members_left_date ON members(left_date);

-- Комментарии к изменениям:
-- 1. left_date - дата выхода участника из группы (NULL если не выходил)
-- 2. Статус "вышел" для автомобилей - когда владелец покинул клуб
-- 3. Индекс на left_date для быстрого поиска вышедших участников 