-- Простое добавление поля club_car_id в таблицу invitations
-- Дата: 2024-12-19

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

-- Проверяем что поле добавилось
DESCRIBE invitations; 