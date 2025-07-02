-- Проверка структуры таблицы cars
-- Выполните этот запрос чтобы увидеть текущее определение поля status

DESCRIBE cars;

-- Или более детально:
SHOW CREATE TABLE cars;

-- Проверяем текущие значения в поле status
SELECT DISTINCT status FROM cars ORDER BY status; 