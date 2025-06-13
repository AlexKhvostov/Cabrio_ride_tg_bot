const mysql = require('mysql2/promise');
const config = require('../config/config');

class Database {
    constructor() {
        this.connection = null;
        this.isConnected = false;
        this.init();
    }

    async init() {
        try {
            // Создаём подключение к MySQL
            this.connection = await mysql.createConnection({
                host: config.DATABASE.host,
                user: config.DATABASE.user,
                password: config.DATABASE.password,
                database: config.DATABASE.database,
                port: config.DATABASE.port
            });

            console.log('✅ Подключено к базе данных MySQL');
            
            // Проверяем подключение
            await this.connection.ping();
            console.log('✅ База данных доступна');
            this.isConnected = true;
            
        } catch (error) {
            console.error('❌ Ошибка подключения к базе данных:', error.message);
            console.log('⚠️  Бот будет работать в режиме без базы данных');
            this.isConnected = false;
            // НЕ выбрасываем ошибку, позволяем боту работать без БД
        }
    }

    // Проверка подключения перед выполнением запросов
    checkConnection() {
        if (!this.isConnected) {
            console.log('⚠️  База данных недоступна. Операция пропущена.');
            return false;
        }
        return true;
    }

    // Методы для работы с участниками
    async getMemberByTelegramId(telegramId) {
        if (!this.checkConnection()) return null;
        
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM members WHERE telegram_id = ?',
                [telegramId]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка получения участника:', error);
            
            // Если ошибка связана с подключением, пытаемся переподключиться
            if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST') {
                console.log('🔄 Попытка переподключения к базе данных...');
                try {
                    await this.init();
                    if (this.isConnected) {
                        console.log('✅ Переподключение успешно');
                        
                        // Повторяем запрос
                        const [rows] = await this.connection.execute(
                            'SELECT * FROM members WHERE telegram_id = ?',
                            [telegramId]
                        );
                        return rows.length > 0 ? rows[0] : null;
                    }
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError);
                    return null; // Возвращаем null вместо выброса ошибки
                }
            }
            
            // Для других ошибок возвращаем null
            return null;
        }
    }

    async getMemberById(memberId) {
        if (!this.checkConnection()) return null;
        
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM members WHERE id = ?',
                [memberId]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка получения участника по ID:', error);
            return null;
        }
    }

    async createMember(memberData) {
        if (!this.checkConnection()) {
            console.log('⚠️  Создание участника пропущено - БД недоступна');
            return null; // Возвращаем null, чтобы показать, что операция не удалась
        }
        
        try {
            console.log('🔍 Отладка createMember:');
            console.log('memberData:', JSON.stringify(memberData, null, 2));
            
            const {
                telegram_id, first_name, last_name, nickname, alias,
                phone, email, country, city, photo_url, 
                join_date, status, about
            } = memberData;

            const [result] = await this.connection.execute(
                `INSERT INTO members (
                    telegram_id, first_name, last_name, nickname, alias,
                    phone, email, country, city, photo_url,
                    join_date, status, about
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    telegram_id, 
                    first_name, 
                    last_name || null, 
                    nickname || null, 
                    alias || null,
                    phone || null, 
                    email || null, 
                    country || null, 
                    city || null, 
                    photo_url || null,
                    join_date, 
                    status || 'новый', 
                    about || null
                ]
            );

            return { id: result.insertId, ...memberData };
        } catch (error) {
            console.error('Ошибка создания участника:', error);
            return null;
        }
    }

    async updateMember(telegramId, updates) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const fields = Object.keys(updates);
            const values = Object.values(updates);
            const setClause = fields.map(field => `${field} = ?`).join(', ');

            const [result] = await this.connection.execute(
                `UPDATE members SET ${setClause} WHERE telegram_id = ?`,
                [...values, telegramId]
            );

            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка обновления участника:', error);
            return { affectedRows: 0 };
        }
    }

    // Методы для работы с автомобилями
    async getCarsByMemberId(memberId) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE member_id = ? ORDER BY created_at DESC',
                [memberId]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения автомобилей:', error);
            return [];
        }
    }

    async createCar(carData) {
        if (!this.checkConnection()) {
            console.log('⚠️  Создание автомобиля пропущено - БД недоступна');
            return null; // Возвращаем null, чтобы показать, что операция не удалась
        }
        
        try {
            const {
                member_id, brand, model, generation, year, color,
                vin, reg_number, engine_volume, engine_power,
                roof_type, status, description, photos
            } = carData;

            const [result] = await this.connection.execute(
                `INSERT INTO cars (
                    member_id, brand, model, generation, year, color,
                    vin, reg_number, engine_volume, engine_power,
                    roof_type, status, description, photos
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    member_id, 
                    brand, 
                    model, 
                    generation || null, 
                    year, 
                    color || null,
                    vin || null, 
                    reg_number || null, 
                    engine_volume || null, 
                    engine_power || null,
                    roof_type || null, 
                    status || 'активный', 
                    description || null, 
                    photos || null
                ]
            );

            return { id: result.insertId, ...carData };
        } catch (error) {
            console.error('Ошибка создания автомобиля:', error);
            return null;
        }
    }

    async updateCar(carId, updates) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const fields = Object.keys(updates);
            const values = Object.values(updates);
            const setClause = fields.map(field => `${field} = ?`).join(', ');

            const [result] = await this.connection.execute(
                `UPDATE cars SET ${setClause} WHERE id = ?`,
                [...values, carId]
            );

            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка обновления автомобиля:', error);
            return { affectedRows: 0 };
        }
    }

    // Методы для работы с приглашениями
    async createInvitation(invitationData) {
        if (!this.checkConnection()) {
            console.log('⚠️  Создание приглашения пропущено - БД недоступна');
            return null; // Возвращаем null, чтобы показать, что операция не удалась
        }
        
        try {
            const {
                car_id, invitation_date, location, inviter_member_id,
                status, contact_phone, contact_name, notes
            } = invitationData;

            const [result] = await this.connection.execute(
                `INSERT INTO invitations (
                    car_id, invitation_date, location, inviter_member_id,
                    status, contact_phone, contact_name, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    car_id, invitation_date, location, inviter_member_id,
                    status || 'новое', contact_phone, contact_name, notes
                ]
            );

            return { id: result.insertId, ...invitationData };
        } catch (error) {
            console.error('Ошибка создания приглашения:', error);
            return null;
        }
    }

    async getInvitationsByInviter(inviterMemberId) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(
                `SELECT i.*, c.brand, c.model, c.year, c.reg_number
                 FROM invitations i 
                 JOIN cars c ON i.car_id = c.id 
                 WHERE i.inviter_member_id = ?
                 ORDER BY i.invitation_date DESC`,
                [inviterMemberId]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения приглашений:', error);
            return [];
        }
    }

    async getInvitationsByCar(carId) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(
                `SELECT i.*, m.first_name, m.last_name, m.nickname
                 FROM invitations i
                 LEFT JOIN members m ON i.inviter_member_id = m.id
                 WHERE i.car_id = ?
                 ORDER BY i.invitation_date DESC`,
                [carId]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения приглашений по автомобилю:', error);
            return [];
        }
    }

    async updateInvitation(invitationId, updates) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const fields = Object.keys(updates);
            const values = Object.values(updates);
            const setClause = fields.map(field => `${field} = ?`).join(', ');

            const [result] = await this.connection.execute(
                `UPDATE invitations SET ${setClause} WHERE id = ?`,
                [...values, invitationId]
            );

            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка обновления приглашения:', error);
            return { affectedRows: 0 };
        }
    }

    // Статистика
    async getStats() {
        if (!this.checkConnection()) {
            return {
                totalMembers: 0,
                activeMembers: 0,
                totalCars: 0,
                totalInvitations: 0,
                successfulInvitations: 0,
                leftMembers: 0,
                leftCars: 0
            };
        }
        
        try {
            const queries = [
                'SELECT COUNT(*) as count FROM members WHERE status != "вышел"', // Исключаем вышедших
                'SELECT COUNT(*) as count FROM members WHERE status = "активный"',
                'SELECT COUNT(*) as count FROM cars WHERE status != "вышел"', // Исключаем авто вышедших
                'SELECT COUNT(*) as count FROM invitations',
                'SELECT COUNT(*) as count FROM invitations WHERE status = "вступил в клуб"',
                'SELECT COUNT(*) as count FROM members WHERE status = "вышел"', // Количество вышедших
                'SELECT COUNT(*) as count FROM cars WHERE status = "вышел"' // Количество авто вышедших
            ];

            const results = await Promise.all(
                queries.map(query => this.connection.execute(query))
            );

            return {
                totalMembers: results[0][0][0].count, // Только активные участники
                activeMembers: results[1][0][0].count,
                totalCars: results[2][0][0].count, // Только активные авто
                totalInvitations: results[3][0][0].count,
                successfulInvitations: results[4][0][0].count,
                leftMembers: results[5][0][0].count, // Вышедшие участники
                leftCars: results[6][0][0].count // Авто вышедших
            };
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            return {
                totalMembers: 0,
                activeMembers: 0,
                totalCars: 0,
                totalInvitations: 0,
                successfulInvitations: 0,
                leftMembers: 0,
                leftCars: 0
            };
        }
    }

    // Поиск автомобилей по регистрационному номеру
    async getCarsByRegNumber(regNumber) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE reg_number = ? ORDER BY created_at DESC',
                [regNumber]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка поиска автомобилей по номеру:', error);
            return [];
        }
    }

    // Поиск автомобилей по частичному совпадению номера
    async searchCarsByRegNumber(partialRegNumber) {
        if (!this.checkConnection()) return [];
        
        try {
            const searchPattern = `%${partialRegNumber.toUpperCase()}%`;
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE reg_number LIKE ? ORDER BY created_at DESC',
                [searchPattern]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка поиска автомобилей по частичному номеру:', error);
            return [];
        }
    }

    // Поиск автомобилей без владельца для приглашений
    async getCarsWithoutOwner() {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE member_id IS NULL AND status = "приглашение" ORDER BY created_at DESC'
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения автомобилей без владельца:', error);
            return [];
        }
    }

    async close() {
        if (this.connection && this.isConnected) {
            try {
                await this.connection.end();
                console.log('✅ Соединение с базой данных закрыто');
            } catch (error) {
                console.error('❌ Ошибка закрытия соединения:', error.message);
            }
        }
    }
}

module.exports = new Database(); 