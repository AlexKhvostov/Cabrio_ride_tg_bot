-- Создание таблицы участников
CREATE TABLE members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    telegram_id BIGINT NOT NULL UNIQUE,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50),
    nickname VARCHAR(50),
    alias VARCHAR(50),
    birth_date DATE,
    phone VARCHAR(20),
    email VARCHAR(100),
    country VARCHAR(50),
    city VARCHAR(100),
    photo_url VARCHAR(255),
    join_date DATE NOT NULL,
    status ENUM('новый', 'активный', 'вышел', 'без авто', 'invite') DEFAULT 'новый',
    about TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Создание таблицы автомобилей
CREATE TABLE cars (
    id INT PRIMARY KEY AUTO_INCREMENT,
    member_id INT,
    brand VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    generation VARCHAR(50),
    year INT NOT NULL,
    color VARCHAR(50),
    vin VARCHAR(17),
    reg_number VARCHAR(20),
    engine_volume DECIMAL(2,1),
    engine_power INT,
    roof_type ENUM('soft', 'hard', 'targa'),
    status ENUM('активный', 'продан', 'в ремонте', 'разбит', 'приглашение') DEFAULT 'активный',
    purchase_date DATE,
    sale_date DATE,
    description TEXT,
    notes TEXT,
    photos TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Создание таблицы приглашений
CREATE TABLE invitations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    car_id INT NOT NULL,
    invitation_date DATE NOT NULL,
    location VARCHAR(255) NOT NULL,
    inviter_member_id INT NOT NULL,
    status ENUM('новое', 'нет ответа', 'на связи', 'встреча назначена', 'встреча проведена', 'отказ', 'вступил в клуб') DEFAULT 'новое',
    contact_phone VARCHAR(20),
    contact_name VARCHAR(100),
    next_contact_date DATE,
    meeting_date DATETIME,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE RESTRICT,
    FOREIGN KEY (inviter_member_id) REFERENCES members(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Добавление индексов для оптимизации запросов
CREATE INDEX idx_members_telegram_id ON members(telegram_id);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_cars_member_id ON cars(member_id);
CREATE INDEX idx_cars_status ON cars(status);
CREATE INDEX idx_invitations_car_id ON invitations(car_id);
CREATE INDEX idx_invitations_inviter_member_id ON invitations(inviter_member_id);
CREATE INDEX idx_invitations_status ON invitations(status); 