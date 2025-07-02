-- Добавление поля club_car_id в таблицу invitations
-- Дата: 2024-12-19

-- ========================================
-- ДОБАВЛЕНИЕ НОВОГО ПОЛЯ
-- ========================================

-- Добавляем поле для связи с реально добавленной машиной в клубе
ALTER TABLE invitations 
ADD COLUMN club_car_id INT NULL 
COMMENT 'ID машины в клубе (cars.id), которая соответствует приглашенной машине'
AFTER car_id;

-- Добавляем внешний ключ для связи с таблицей cars
ALTER TABLE invitations 
ADD CONSTRAINT fk_invitations_club_car 
FOREIGN KEY (club_car_id) REFERENCES cars(id) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- ========================================
-- ОБНОВЛЕНИЕ СУЩЕСТВУЮЩИХ ЗАПИСЕЙ
-- ========================================

-- Находим и связываем уже существующие машины по номерам
-- Сравниваем номера через связанную таблицу cars (приглашенный автомобиль -> реальный автомобиль)
UPDATE invitations i
INNER JOIN cars invited_car ON i.car_id = invited_car.id
INNER JOIN cars club_car ON (
    -- Сравниваем номера (убираем пробелы и приводим к нижнему регистру)
    LOWER(REPLACE(invited_car.reg_number, ' ', '')) = LOWER(REPLACE(club_car.reg_number, ' ', ''))
    AND club_car.status IN ('активный', 'в клубе', 'на модерации')
    AND club_car.id != invited_car.id  -- Исключаем сам приглашенный автомобиль
    AND club_car.member_id IS NOT NULL  -- Только автомобили с владельцами
)
SET i.club_car_id = club_car.id
WHERE i.club_car_id IS NULL;

-- ========================================
-- ПРОВЕРКА РЕЗУЛЬТАТОВ
-- ========================================

-- Проверяем структуру таблицы
DESCRIBE invitations;

-- Проверяем сколько записей получили связи
SELECT 
    'Всего приглашений' as type,
    COUNT(*) as count
FROM invitations
UNION ALL
SELECT 
    'Связанных с машинами клуба' as type,
    COUNT(*) as count
FROM invitations 
WHERE club_car_id IS NOT NULL
UNION ALL
SELECT 
    'Без связи с машинами клуба' as type,
    COUNT(*) as count
FROM invitations 
WHERE club_car_id IS NULL;

-- Детальный отчет по связанным записям
SELECT 
    i.id as invitation_id,
    invited_car.reg_number as invited_number,
    invited_car.brand as invited_brand,
    invited_car.model as invited_model,
    i.status as invitation_status,
    club_car.id as club_car_id,
    club_car.reg_number as club_number,
    club_car.brand as club_brand,
    club_car.model as club_model,
    club_car.status as club_car_status,
    CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')) as owner_name
FROM invitations i
INNER JOIN cars invited_car ON i.car_id = invited_car.id
INNER JOIN cars club_car ON i.club_car_id = club_car.id
INNER JOIN members m ON club_car.member_id = m.id
ORDER BY i.id;

-- ========================================
-- ДОПОЛНИТЕЛЬНЫЕ ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ
-- ========================================

-- Добавляем индексы для быстрого поиска по номерам
CREATE INDEX idx_cars_reg_number ON cars(reg_number);
CREATE INDEX idx_invitations_car_id ON invitations(car_id);

-- Добавляем составной индекс для связанных запросов
CREATE INDEX idx_invitations_club_car_status ON invitations(club_car_id, status);

SELECT 'Добавление поля club_car_id завершено!' as result; 