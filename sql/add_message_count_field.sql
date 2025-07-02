-- Добавление поля для подсчета сообщений пользователя
-- Дата: Январь 2025

-- Добавляем поле message_count в таблицу members
ALTER TABLE members 
ADD COLUMN message_count INT DEFAULT 0 COMMENT 'Количество сообщений пользователя в чате';

-- Создаем индекс для быстрого поиска по количеству сообщений
CREATE INDEX idx_members_message_count ON members(message_count);

-- Создаем составной индекс для проверки активности (сообщения + наличие авто)
CREATE INDEX idx_members_activity ON members(message_count, status);

-- Обновляем существующих пользователей (устанавливаем 0 сообщений)
UPDATE members SET message_count = 0 WHERE message_count IS NULL;

-- Комментарий к изменению
-- Поле message_count будет увеличиваться при каждом сообщении пользователя в чате
-- При достижении 3+ сообщений и наличии автомобиля статус меняется на "активный" 