-- Добавление поля birth_date в таблицу members
-- Дата: 2024
-- Описание: Добавляет поле для хранения даты рождения участников

ALTER TABLE members 
ADD COLUMN birth_date DATE NULL 
COMMENT 'Дата рождения участника' 
AFTER last_name;

-- Проверяем что поле добавлено
DESCRIBE members; 