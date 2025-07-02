-- =====================================================
-- 🏗️ Создание таблиц Events и Services для Cabrio Club
-- =====================================================
-- Дата: Январь 2025
-- Описание: Добавление функционала событий клуба и каталога сервисов

-- =====================================================
-- 🎉 Таблица events (События клуба)
-- =====================================================

CREATE TABLE IF NOT EXISTS `events` (
    -- Основная информация
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL COMMENT 'Название события',
    `description` TEXT NULL COMMENT 'Описание события',
    `event_date` DATE NOT NULL COMMENT 'Дата события',
    `event_time` TIME NULL COMMENT 'Время события',
    `location` VARCHAR(300) NOT NULL COMMENT 'Место проведения',
    `city` VARCHAR(100) NOT NULL COMMENT 'Город',
    
    -- Классификация
    `type` ENUM(
        'заезд',
        'встреча', 
        'фотосессия',
        'поездка',
        'банкет',
        'техническая встреча'
    ) NOT NULL DEFAULT 'встреча' COMMENT 'Тип события',
    
    -- Статус и участники
    `status` ENUM(
        'запланировано',
        'проводится',
        'завершено',
        'отменено'
    ) NOT NULL DEFAULT 'запланировано' COMMENT 'Статус события',
    
    `organizer_id` INT(11) NOT NULL COMMENT 'ID организатора',
    `participants_count` INT(11) NOT NULL DEFAULT 0 COMMENT 'Текущее количество участников',
    `max_participants` INT(11) NULL COMMENT 'Максимальное количество участников',
    `price` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Стоимость участия в рублях',
    
    -- Медиа и мета-данные
    `photos` TEXT NULL COMMENT 'Фотографии в JSON формате',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата создания',
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Дата обновления',
    
    -- Первичный ключ
    PRIMARY KEY (`id`),
    
    -- Внешние ключи
    CONSTRAINT `fk_events_organizer` 
        FOREIGN KEY (`organizer_id`) 
        REFERENCES `members` (`id`) 
        ON DELETE CASCADE 
        ON UPDATE CASCADE,
    
    -- Индексы для быстрого поиска и фильтрации
    INDEX `idx_events_date` (`event_date`),
    INDEX `idx_events_city` (`city`),
    INDEX `idx_events_type` (`type`),
    INDEX `idx_events_status` (`status`),
    INDEX `idx_events_organizer` (`organizer_id`),
    INDEX `idx_events_date_status` (`event_date`, `status`)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='События клуба кабриолетов';

-- =====================================================
-- 🔧 Таблица services (Каталог сервисов)
-- =====================================================

CREATE TABLE IF NOT EXISTS `services` (
    -- Основная информация
    `id` INT(11) NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL COMMENT 'Название сервиса',
    `description` TEXT NULL COMMENT 'Описание услуг',
    `city` VARCHAR(100) NOT NULL COMMENT 'Город',
    `address` VARCHAR(300) NULL COMMENT 'Адрес',
    `phone` VARCHAR(20) NULL COMMENT 'Телефон',
    `website` VARCHAR(200) NULL COMMENT 'Веб-сайт',
    
    -- Классификация
    `type` ENUM(
        'автосервис',
        'детейлинг',
        'шиномонтаж',
        'электрик',
        'автомойка',
        'тюнинг',
        'страхование'
    ) NOT NULL DEFAULT 'автосервис' COMMENT 'Тип услуг',
    
    -- Рейтинг и рекомендации
    `recommendation` ENUM(
        'рекомендуется',
        'не рекомендуется',
        'нейтрально'
    ) NOT NULL DEFAULT 'нейтрально' COMMENT 'Рекомендация клуба',
    
    `rating` DECIMAL(2,1) NULL COMMENT 'Средний рейтинг (1.0-5.0)',
    `reviews_count` INT(11) NOT NULL DEFAULT 0 COMMENT 'Количество отзывов',
    
    -- Дополнительная информация
    `services_list` TEXT NULL COMMENT 'Список услуг в JSON формате',
    `price_range` ENUM(
        'низкий',
        'средний', 
        'высокий'
    ) NULL COMMENT 'Ценовой диапазон',
    `working_hours` VARCHAR(100) NULL COMMENT 'Часы работы',
    
    -- Медиа и мета-данные
    `photos` TEXT NULL COMMENT 'Фотографии в JSON формате',
    `added_by_member_id` INT(11) NULL COMMENT 'Кто добавил сервис',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата добавления',
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Дата обновления',
    
    -- Первичный ключ
    PRIMARY KEY (`id`),
    
    -- Внешние ключи
    CONSTRAINT `fk_services_added_by` 
        FOREIGN KEY (`added_by_member_id`) 
        REFERENCES `members` (`id`) 
        ON DELETE SET NULL 
        ON UPDATE CASCADE,
    
    -- Индексы для быстрого поиска и фильтрации
    INDEX `idx_services_city` (`city`),
    INDEX `idx_services_type` (`type`),
    INDEX `idx_services_recommendation` (`recommendation`),
    INDEX `idx_services_rating` (`rating`),
    INDEX `idx_services_added_by` (`added_by_member_id`),
    INDEX `idx_services_city_type` (`city`, `type`)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='Каталог сервисов для автомобилей';

-- =====================================================
-- 🎯 Вставка тестовых данных
-- =====================================================

-- Тестовые события
INSERT INTO `events` (
    `title`, `description`, `event_date`, `event_time`, `location`, `city`, 
    `type`, `status`, `organizer_id`, `max_participants`, `price`
) VALUES 
(
    'Весенний заезд в Подмосковье',
    'Традиционный весенний заезд клуба по живописным местам Подмосковья. Маршрут проходит через исторические усадьбы и красивые природные локации.',
    '2024-04-15', '10:00:00', 'Усадьба Архангельское', 'Москва',
    'заезд', 'запланировано', 1, 20, 0.00
),
(
    'Техническая встреча',
    'Встреча для обсуждения технических вопросов обслуживания кабриолетов. Приглашены эксперты автосервисов.',
    '2024-04-08', '19:00:00', 'Автосервис "Кабрио Центр"', 'Москва',
    'техническая встреча', 'запланировано', 1, 15, 500.00
),
(
    'Фотосессия в СПб',
    'Профессиональная фотосессия участников клуба на фоне архитектуры Санкт-Петербурга.',
    '2024-04-22', '14:00:00', 'Дворцовая площадь', 'СПб',
    'фотосессия', 'запланировано', 1, 10, 1500.00
),
(
    'Зимняя встреча в гараже',
    'Традиционная зимняя встреча участников клуба для обсуждения планов на новый сезон.',
    '2024-01-20', '18:00:00', 'Гараж "Классик Авто"', 'Москва',
    'встреча', 'завершено', 1, 25, 0.00
);

-- Тестовые сервисы
INSERT INTO `services` (
    `name`, `description`, `city`, `address`, `phone`, `website`,
    `type`, `recommendation`, `rating`, `reviews_count`, `price_range`, `working_hours`
) VALUES 
(
    'Автосервис "Кабрио Центр"',
    'Специализированный сервис по обслуживанию кабриолетов. Ремонт крыш, диагностика, ТО.',
    'Москва', 'ул. Автомобильная, 15', '+7 (495) 123-45-67', 'https://cabrio-center.ru',
    'автосервис', 'рекомендуется', 4.8, 24, 'высокий', 'Пн-Пт: 9:00-19:00, Сб: 10:00-16:00'
),
(
    'Детейлинг "Блеск"',
    'Профессиональный детейлинг автомобилей. Полировка, керамические покрытия, химчистка салонов.',
    'Москва', 'пр-т Мира, 45', '+7 (495) 987-65-43', 'https://blesk-detailing.ru',
    'детейлинг', 'рекомендуется', 4.9, 18, 'средний', 'Ежедневно: 9:00-21:00'
),
(
    'Шиномонтаж "Быстрые колеса"',
    'Качественный шиномонтаж и балансировка. Большой выбор шин премиум-класса.',
    'СПб', 'Невский пр-т, 120', '+7 (812) 456-78-90', NULL,
    'шиномонтаж', 'рекомендуется', 4.3, 31, 'низкий', 'Пн-Вс: 8:00-22:00'
),
(
    'СТО "Гараж 77"',
    'Обычный автосервис. Были жалобы на качество работ и завышенные цены.',
    'Москва', 'ул. Промышленная, 77', '+7 (495) 111-22-33', NULL,
    'автосервис', 'не рекомендуется', 2.1, 12, 'высокий', 'Пн-Пт: 9:00-18:00'
);

-- =====================================================
-- ✅ Скрипт выполнен успешно
-- =====================================================

SELECT 'Таблицы events и services созданы успешно!' as status;
SELECT COUNT(*) as events_count FROM events;
SELECT COUNT(*) as services_count FROM services; 