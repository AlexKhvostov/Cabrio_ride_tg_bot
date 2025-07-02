-- Создание таблицы для логирования попыток авторизации через Telegram
CREATE TABLE IF NOT EXISTS auth_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    telegram_id BIGINT NOT NULL,
    username VARCHAR(255) DEFAULT NULL,
    first_name VARCHAR(255) DEFAULT NULL,
    last_name VARCHAR(255) DEFAULT NULL,
    is_member BOOLEAN DEFAULT FALSE,
    member_id INT DEFAULT NULL,
    auth_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45) DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    auth_hash VARCHAR(255) DEFAULT NULL,
    status ENUM('success', 'failed', 'denied') DEFAULT 'success',
    notes TEXT DEFAULT NULL,
    
    INDEX idx_telegram_id (telegram_id),
    INDEX idx_auth_date (auth_date),
    INDEX idx_is_member (is_member),
    INDEX idx_status (status),
    
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Комментарии к полям
ALTER TABLE auth_log 
    MODIFY COLUMN telegram_id BIGINT NOT NULL COMMENT 'Telegram ID пользователя',
    MODIFY COLUMN username VARCHAR(255) DEFAULT NULL COMMENT 'Telegram username (без @)',
    MODIFY COLUMN first_name VARCHAR(255) DEFAULT NULL COMMENT 'Имя пользователя в Telegram',
    MODIFY COLUMN last_name VARCHAR(255) DEFAULT NULL COMMENT 'Фамилия пользователя в Telegram',
    MODIFY COLUMN is_member BOOLEAN DEFAULT FALSE COMMENT 'Является ли участником клуба',
    MODIFY COLUMN member_id INT DEFAULT NULL COMMENT 'ID участника в таблице members',
    MODIFY COLUMN auth_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Дата и время попытки авторизации',
    MODIFY COLUMN ip_address VARCHAR(45) DEFAULT NULL COMMENT 'IP адрес пользователя',
    MODIFY COLUMN user_agent TEXT DEFAULT NULL COMMENT 'User Agent браузера',
    MODIFY COLUMN auth_hash VARCHAR(255) DEFAULT NULL COMMENT 'Хеш авторизации для проверки',
    MODIFY COLUMN status ENUM('success', 'failed', 'denied') DEFAULT 'success' COMMENT 'Статус авторизации',
    MODIFY COLUMN notes TEXT DEFAULT NULL COMMENT 'Дополнительные заметки';

-- Добавляем комментарий к таблице
ALTER TABLE auth_log COMMENT = 'Лог всех попыток авторизации через Telegram на веб-сайте'; 