const mysql = require('mysql2/promise');
const config = require('../config/config');

class Database {
    constructor() {
        this.connection = null;
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
            
        } catch (error) {
            console.error('❌ Ошибка подключения к базе данных:', error.message);
            throw error;
        }
    }

    // Методы для работы с участниками
    async getMemberByTelegramId(telegramId) {
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM members WHERE telegram_id = ?',
                [telegramId]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка получения участника:', error);
            throw error;
        }
    }

    async getMemberById(memberId) {
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM members WHERE id = ?',
                [memberId]
            );
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка получения участника по ID:', error);
            throw error;
        }
    }

    async createMember(memberData) {
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
            throw error;
        }
    }

    async updateMember(telegramId, updates) {
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
            throw error;
        }
    }

    // Методы для работы с автомобилями
    async getCarsByMemberId(memberId) {
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE member_id = ? ORDER BY created_at DESC',
                [memberId]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения автомобилей:', error);
            throw error;
        }
    }

    async createCar(carData) {
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
            throw error;
        }
    }

    async updateCar(carId, updates) {
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
            throw error;
        }
    }

    // Методы для работы с приглашениями
    async createInvitation(invitationData) {
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
            throw error;
        }
    }

    async getInvitationsByInviter(inviterMemberId) {
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
            throw error;
        }
    }

    async getInvitationsByCar(carId) {
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
            throw error;
        }
    }

    async updateInvitation(invitationId, updates) {
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
            throw error;
        }
    }

    // Статистика
    async getStats() {
        try {
            const queries = [
                'SELECT COUNT(*) as count FROM members',
                'SELECT COUNT(*) as count FROM members WHERE status = "активный"',
                'SELECT COUNT(*) as count FROM cars',
                'SELECT COUNT(*) as count FROM invitations',
                'SELECT COUNT(*) as count FROM invitations WHERE status = "вступил в клуб"'
            ];

            const results = await Promise.all(
                queries.map(query => this.connection.execute(query))
            );

            return {
                totalMembers: results[0][0][0].count,
                activeMembers: results[1][0][0].count,
                totalCars: results[2][0][0].count,
                totalInvitations: results[3][0][0].count,
                successfulInvitations: results[4][0][0].count
            };
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            throw error;
        }
    }

    // Поиск автомобилей по регистрационному номеру
    async getCarsByRegNumber(regNumber) {
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE reg_number = ? ORDER BY created_at DESC',
                [regNumber]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка поиска автомобилей по номеру:', error);
            throw error;
        }
    }

    // Поиск автомобилей по частичному совпадению номера
    async searchCarsByRegNumber(partialRegNumber) {
        try {
            const searchPattern = `%${partialRegNumber.toUpperCase()}%`;
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE reg_number LIKE ? ORDER BY created_at DESC',
                [searchPattern]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка поиска автомобилей по частичному номеру:', error);
            throw error;
        }
    }

    // Поиск автомобилей без владельца для приглашений
    async getCarsWithoutOwner() {
        try {
            const [rows] = await this.connection.execute(
                'SELECT * FROM cars WHERE member_id IS NULL AND status = "приглашение" ORDER BY created_at DESC'
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения автомобилей без владельца:', error);
            throw error;
        }
    }

    async close() {
        if (this.connection) {
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