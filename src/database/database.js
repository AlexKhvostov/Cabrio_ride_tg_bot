const mysql = require('mysql2/promise');
const config = require('../config/config');

class Database {
    constructor() {
        this.connection = null;
        this.isConnected = false;
        this.init();
    }

	/**
	 * Инициализация подключения к базе данных
	 * Создает пул соединений для предотвращения ошибок "connection is in closed state"
	 */
	async init() {
		try {
			// Создаем ПУЛ соединений вместо одиночного подключения
			// Пул автоматически управляет соединениями и переподключается при разрыве
			this.connection = mysql.createPool({
				host: config.DATABASE.host,
				user: config.DATABASE.user,
				password: config.DATABASE.password,
				database: config.DATABASE.database,
				port: config.DATABASE.port,
				
				// Настройки пула для стабильности:
				waitForConnections: true,    // Ждать свободное соединение если все заняты
				connectionLimit: 10,         // Максимум 10 одновременных соединений
				queueLimit: 0,              // Без ограничений на очередь запросов
				acquireTimeout: 60000,      // Таймаут получения соединения (60 сек)
				timeout: 60000              // Таймаут выполнения запроса (60 сек)
			});

			console.log('✅ Пул подключений к MySQL создан');
			
			// Проверяем подключение через временное соединение из пула
			// Это безопаснее чем ping() на самом пуле
			const testConnection = await this.connection.getConnection();
			await testConnection.ping();  // Проверяем что соединение живое
			testConnection.release();     // ВАЖНО: освобождаем соединение обратно в пул
			
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
                telegram_id, first_name, last_name, birth_date, nickname, alias,
                phone, email, country, city, photo_url, 
                join_date, status, about
            } = memberData;

            const [result] = await this.connection.execute(
                `INSERT INTO members (
                    telegram_id, first_name, last_name, birth_date, nickname, alias,
                    phone, email, country, city, photo_url,
                    join_date, status, about
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    telegram_id, 
                    first_name, 
                    last_name || null,
                    birth_date || null,
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

    async getInvitationsByCarNumber(regNumber) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(
                `SELECT i.*, m.first_name, m.last_name, m.nickname, c.reg_number, c.brand, c.model
                 FROM invitations i
                 LEFT JOIN members m ON i.inviter_member_id = m.id
                 INNER JOIN cars c ON i.car_id = c.id
                 WHERE c.reg_number = ?
                 ORDER BY i.invitation_date DESC`,
                [regNumber]
            );
            return rows;
        } catch (error) {
            console.error('Ошибка получения приглашений по номеру автомобиля:', error);
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
        const defaultStats = {
            totalMembers: 0,
            activeMembers: 0,
            totalCars: 0,
            totalInvitations: 0,
            successfulInvitations: 0,
            leftMembers: 0,
            leftCars: 0
        };

        if (!this.checkConnection()) {
            return defaultStats;
        }
        
        try {
            const queries = [
                'SELECT COUNT(*) as count FROM members WHERE status != "вышел"', // Исключаем вышедших
                'SELECT COUNT(*) as count FROM members WHERE status = "активный"',
                'SELECT COUNT(*) as count FROM cars WHERE status != "вышел" AND member_id IS NOT NULL', // Только авто с владельцами
                'SELECT COUNT(*) as count FROM invitations',
                'SELECT COUNT(*) as count FROM invitations WHERE status = "вступил в клуб"',
                'SELECT COUNT(*) as count FROM members WHERE status = "вышел"', // Количество вышедших
                'SELECT COUNT(*) as count FROM cars WHERE status = "вышел" AND member_id IS NOT NULL' // Авто вышедших с владельцами
            ];

            const results = await Promise.all(
                queries.map(query => this.connection.execute(query))
            );

            return {
                totalMembers: results[0][0][0].count, // Только активные участники
                activeMembers: results[1][0][0].count,
                totalCars: results[2][0][0].count, // Только авто с владельцами (исключая приглашения)
                totalInvitations: results[3][0][0].count,
                successfulInvitations: results[4][0][0].count,
                leftMembers: results[5][0][0].count, // Вышедшие участники
                leftCars: results[6][0][0].count // Авто вышедших с владельцами
            };
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            
            // Если ошибка связана с подключением, пытаемся переподключиться
            if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ENOTFOUND') {
                console.log('🔄 Попытка переподключения к базе данных...');
                try {
                    await this.init();
                    if (this.isConnected) {
                        console.log('✅ Переподключение успешно, повторяем запрос статистики');
                        return await this.getStats(); // Рекурсивный вызов после переподключения
                    }
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError);
                }
            }
            
            return defaultStats;
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
                'SELECT * FROM cars WHERE reg_number LIKE ? AND status IN ("активный", "приглашение", "на модерации") ORDER BY created_at DESC',
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

	/**
	 * Корректное закрытие пула соединений
	 * Вызывается при завершении работы приложения
	 */
	async close() {
		if (this.connection && this.isConnected) {
			try {
				// Закрываем ВСЕ соединения в пуле
				// end() ждет завершения всех активных запросов перед закрытием
				await this.connection.end();
				console.log('✅ Пул соединений закрыт');
				this.isConnected = false;  // Обновляем флаг состояния
			} catch (error) {
				console.error('❌ Ошибка закрытия пула:', error.message);
			}
		}
	}

    // Функции для API
    async getAllMembers() {
        console.log('🔍 getAllMembers: isConnected =', this.isConnected);
        
        if (!this.checkConnection()) {
            console.log('⚠️ getAllMembers: checkConnection вернул false');
            return [];
        }
        
        try {
            console.log('🔍 getAllMembers: выполняем запрос к БД');
            const [rows] = await this.connection.execute(`
                SELECT m.*, 
                       c.id as car_id, c.brand, c.model, c.reg_number, c.photos as car_photos
                FROM members m 
                LEFT JOIN cars c ON m.id = c.member_id 
                ORDER BY m.join_date DESC, c.created_at DESC
            `);
            console.log('✅ getAllMembers: получено записей:', rows.length);
            
            // Группируем автомобили по участникам
            const membersMap = new Map();
            
            rows.forEach(row => {
                const memberId = row.id;
                
                if (!membersMap.has(memberId)) {
                    membersMap.set(memberId, {
                        id: row.id,
                        telegram_id: row.telegram_id,
                        first_name: row.first_name,
                        last_name: row.last_name,
                        nickname: row.nickname,
                        city: row.city,
                        photo_url: row.photo_url,
                        status: row.status,
                        join_date: row.join_date,
                        left_date: row.left_date,
                        cars: []
                    });
                }
                
                // Добавляем автомобиль если он есть
                if (row.car_id) {
                    membersMap.get(memberId).cars.push({
                        id: row.car_id,
                        brand: row.brand,
                        model: row.model,
                        reg_number: row.reg_number,
                        photos: row.car_photos
                    });
                }
            });
            
            return Array.from(membersMap.values());
        } catch (error) {
            console.error('Ошибка получения всех участников:', error);
            
            // Если ошибка связана с подключением, пытаемся переподключиться
            if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ENOTFOUND') {
                console.log('🔄 Попытка переподключения к базе данных...');
                try {
                    await this.init();
                    if (this.isConnected) {
                        console.log('✅ Переподключение успешно, повторяем запрос участников');
                        const [rows] = await this.connection.execute(`
                            SELECT m.*, 
                                   c.id as car_id, c.brand, c.model, c.reg_number, c.photos as car_photos
                            FROM members m 
                            LEFT JOIN cars c ON m.id = c.member_id 
                            ORDER BY m.join_date DESC, c.created_at DESC
                        `);
                        
                        // Группируем автомобили по участникам
                        const membersMap = new Map();
                        
                        rows.forEach(row => {
                            const memberId = row.id;
                            
                            if (!membersMap.has(memberId)) {
                                membersMap.set(memberId, {
                                    id: row.id,
                                    telegram_id: row.telegram_id,
                                    first_name: row.first_name,
                                    last_name: row.last_name,
                                    nickname: row.nickname,
                                    city: row.city,
                                    photo_url: row.photo_url,
                                    status: row.status,
                                    join_date: row.join_date,
                                    left_date: row.left_date,
                                    cars: []
                                });
                            }
                            
                            // Добавляем автомобиль если он есть
                            if (row.car_id) {
                                membersMap.get(memberId).cars.push({
                                    id: row.car_id,
                                    brand: row.brand,
                                    model: row.model,
                                    reg_number: row.reg_number,
                                    photos: row.car_photos
                                });
                            }
                        });
                        
                        return Array.from(membersMap.values());
                    }
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError);
                }
            }
            
            return [];
        }
    }

    async getAllCars() {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT c.*, m.first_name, m.last_name, m.nickname, m.photo_url 
                FROM cars c 
                LEFT JOIN members m ON c.member_id = m.id 
                ORDER BY c.created_at DESC
            `);
            return rows;
        } catch (error) {
            console.error('Ошибка получения всех автомобилей:', error);
            
            // Если ошибка связана с подключением, пытаемся переподключиться
            if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ENOTFOUND') {
                console.log('🔄 Попытка переподключения к базе данных...');
                try {
                    await this.init();
                    if (this.isConnected) {
                        console.log('✅ Переподключение успешно, повторяем запрос автомобилей');
                        const [rows] = await this.connection.execute(`
                            SELECT c.*, m.first_name, m.last_name, m.nickname, m.photo_url 
                            FROM cars c 
                            LEFT JOIN members m ON c.member_id = m.id 
                            ORDER BY c.created_at DESC
                        `);
                        return rows;
                    }
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError);
                }
            }
            
            return [];
        }
    }

    async getAllInvitations() {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT i.*, c.brand, c.model, c.reg_number, m.first_name, m.last_name 
                FROM invitations i 
                LEFT JOIN cars c ON i.car_id = c.id 
                LEFT JOIN members m ON i.inviter_member_id = m.id 
                ORDER BY i.invitation_date DESC
            `);
            return rows;
        } catch (error) {
            console.error('Ошибка получения всех приглашений:', error);
            
            // Если ошибка связана с подключением, пытаемся переподключиться
            if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST' || error.code === 'ENOTFOUND') {
                console.log('🔄 Попытка переподключения к базе данных...');
                try {
                    await this.init();
                    if (this.isConnected) {
                        console.log('✅ Переподключение успешно, повторяем запрос приглашений');
                        const [rows] = await this.connection.execute(`
                            SELECT i.*, c.brand, c.model, c.reg_number, m.first_name, m.last_name 
                            FROM invitations i 
                            LEFT JOIN cars c ON i.car_id = c.id 
                            LEFT JOIN members m ON i.inviter_member_id = m.id 
                            ORDER BY i.invitation_date DESC
                        `);
                        return rows;
                    }
                } catch (reconnectError) {
                    console.error('❌ Ошибка переподключения:', reconnectError);
                }
            }
            
            return [];
        }
    }

    // Методы для работы с логами авторизации
    async logAuthAttempt(authData) {
        if (!this.checkConnection()) {
            console.log('⚠️ Логирование авторизации пропущено - БД недоступна');
            return null;
        }
        
        try {
            const {
                telegram_id, username, first_name, last_name,
                is_member, member_id, ip_address, user_agent,
                auth_hash, status, notes
            } = authData;

            const [result] = await this.connection.execute(
                `INSERT INTO auth_log (
                    telegram_id, username, first_name, last_name,
                    is_member, member_id, ip_address, user_agent,
                    auth_hash, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    telegram_id,
                    username || null,
                    first_name || null,
                    last_name || null,
                    is_member || false,
                    member_id || null,
                    ip_address || null,
                    user_agent || null,
                    auth_hash || null,
                    status || 'success',
                    notes || null
                ]
            );

            console.log(`📝 Записан лог авторизации: ${telegram_id} (${first_name}) - ${status}`);
            return { id: result.insertId, ...authData };
        } catch (error) {
            console.error('Ошибка записи лога авторизации:', error);
            return null;
        }
    }

    async getAuthLogs(limit = 100, offset = 0) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT a.*, m.first_name as member_first_name, m.last_name as member_last_name
                FROM auth_log a
                LEFT JOIN members m ON a.member_id = m.id
                ORDER BY a.auth_date DESC
                LIMIT ? OFFSET ?
            `, [limit, offset]);
            return rows;
        } catch (error) {
            console.error('Ошибка получения логов авторизации:', error);
            return [];
        }
    }

    async getAuthLogsByTelegramId(telegramId, limit = 50) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT a.*, m.first_name as member_first_name, m.last_name as member_last_name
                FROM auth_log a
                LEFT JOIN members m ON a.member_id = m.id
                WHERE a.telegram_id = ?
                ORDER BY a.auth_date DESC
                LIMIT ?
            `, [telegramId, limit]);
            return rows;
        } catch (error) {
            console.error('Ошибка получения логов авторизации по Telegram ID:', error);
            return [];
        }
    }

    async getAuthStats() {
        if (!this.checkConnection()) return {
            totalAttempts: 0,
            successfulAttempts: 0,
            failedAttempts: 0,
            memberAttempts: 0,
            nonMemberAttempts: 0,
            uniqueUsers: 0
        };
        
        try {
            const queries = [
                'SELECT COUNT(*) as count FROM auth_log',
                'SELECT COUNT(*) as count FROM auth_log WHERE status = "success"',
                'SELECT COUNT(*) as count FROM auth_log WHERE status IN ("failed", "denied")',
                'SELECT COUNT(*) as count FROM auth_log WHERE is_member = true',
                'SELECT COUNT(*) as count FROM auth_log WHERE is_member = false',
                'SELECT COUNT(DISTINCT telegram_id) as count FROM auth_log'
            ];

            const results = await Promise.all(
                queries.map(query => this.connection.execute(query))
            );

            return {
                totalAttempts: results[0][0][0].count,
                successfulAttempts: results[1][0][0].count,
                failedAttempts: results[2][0][0].count,
                memberAttempts: results[3][0][0].count,
                nonMemberAttempts: results[4][0][0].count,
                uniqueUsers: results[5][0][0].count
            };
        } catch (error) {
            console.error('Ошибка получения статистики авторизации:', error);
            return {
                totalAttempts: 0,
                successfulAttempts: 0,
                failedAttempts: 0,
                memberAttempts: 0,
                nonMemberAttempts: 0,
                uniqueUsers: 0
            };
        }
    }

    // Методы для работы с подсчетом сообщений удалены - функция отключена

    // Проверка и обновление статуса на "участник" при добавлении автомобиля
    async checkAndUpdateCandidateStatus(telegramId) {
        if (!this.checkConnection()) return { success: false };
        
        try {
            // Получаем информацию о пользователе
            const [memberRows] = await this.connection.execute(
                'SELECT * FROM members WHERE telegram_id = ?',
                [telegramId]
            );
            
            if (memberRows.length === 0) {
                return { success: false, message: 'Пользователь не найден' };
            }
            
            const member = memberRows[0];
            
            // ИЕРАРХИЯ СТАТУСОВ - автоматически меняются только "снизу вверх":
            // 🆕 новый → ⚪ без авто → ⚪ участник
            // ✅ активный и 🚫 бан могут менять только админы
            // 🚫 вышел - особый случай (при возвращении становится участником)
            
            // Проверяем условия для автоматического изменения статуса:
            // 1. Статус должен быть "новый" или "без авто" (можно повышать)
            // 2. Есть автомобиль
            const canAutoUpgrade = ['новый', 'без авто'].includes(member.status);
            
            if (!canAutoUpgrade) {
                console.log(`ℹ️ Статус "${member.status}" не может быть автоматически изменён на "участник" для ${member.first_name} (${telegramId})`);
                return { success: true, statusChanged: false };
            }
            
            // Проверяем наличие автомобилей
            const [carRows] = await this.connection.execute(
                'SELECT COUNT(*) as car_count FROM cars WHERE member_id = ? AND status != "вышел"',
                [member.id]
            );
            
            const carCount = carRows[0].car_count;
            
            if (carCount === 0) {
                return { success: true, statusChanged: false };
            }
            
            // Меняем статус на "участник"
            const [updateResult] = await this.connection.execute(
                'UPDATE members SET status = ? WHERE telegram_id = ?',
                ['участник', telegramId]
            );
            
            if (updateResult.affectedRows > 0) {
                console.log(`🚗 Автоматическое изменение статуса: ${member.first_name} (${telegramId}) ${member.status} → участник`);
                
                return {
                    success: true,
                    statusChanged: true,
                    member: {
                        ...member,
                        car_count: carCount,
                        old_status: member.status,
                        new_status: 'участник'
                    }
                };
            }
            
            return { success: false, message: 'Не удалось обновить статус' };
            
        } catch (error) {
            console.error('Ошибка проверки и обновления статуса участника:', error);
            return { success: false, message: 'Ошибка базы данных' };
        }
    }

    // АКТИВНЫЙ статус назначается только администраторами вручную
    async checkAndUpdateActiveStatus(telegramId) {
        if (!this.checkConnection()) return null;
        
        try {
            // В новой системе статус "активный" назначается только админами
            // Этот метод больше не выполняет автоматическую активацию
            console.log(`ℹ️ Статус "активный" назначается только администраторами для пользователя ${telegramId}`);
            return { success: true, statusChanged: false };
        } catch (error) {
            console.error('Ошибка проверки статуса активности:', error);
            return null;
        }
    }

    // Получить расширенную статистику по новым статусам
    async getExtendedStats() {
        if (!this.checkConnection()) return null;
        
        try {
            const stats = {};
            
            // Общая статистика участников по статусам
            const [statusRows] = await this.connection.execute(`
                SELECT status, COUNT(*) as count 
                FROM members 
                WHERE status NOT IN ('вышел', 'бан')
                GROUP BY status
            `);
            
            // Инициализируем все статусы нулями
            stats.новый = 0;
            stats.без_авто = 0;
            stats.участник = 0;
            stats.активный = 0;
            
            // Заполняем реальными данными
            statusRows.forEach(row => {
                const status = row.status.replace(' ', '_'); // "без авто" -> "без_авто"
                if (stats.hasOwnProperty(status)) {
                    stats[status] = row.count;
                }
            });
            
            // Участники с ограниченным доступом
            const [restrictedRows] = await this.connection.execute(`
                SELECT status, COUNT(*) as count 
                FROM members 
                WHERE status IN ('вышел', 'бан')
                GROUP BY status
            `);
            
            stats.вышел = 0;
            stats.бан = 0;
            
            restrictedRows.forEach(row => {
                stats[row.status] = row.count;
            });
            
            // Общие показатели
            stats.totalActiveMembers = stats.новый + stats.без_авто + stats.участник + stats.активный;
            stats.totalRestrictedMembers = stats.вышел + stats.бан;
            stats.totalMembers = stats.totalActiveMembers + stats.totalRestrictedMembers;
            
            // Автомобили (только активных участников)
            const [carsRows] = await this.connection.execute(`
                SELECT COUNT(*) as count 
                FROM cars c 
                INNER JOIN members m ON c.member_id = m.id 
                WHERE m.status NOT IN ('вышел', 'бан') AND c.status != 'вышел'
            `);
            stats.totalCars = carsRows[0].count;
            
            // Приглашения
            const [invitationsRows] = await this.connection.execute(`
                SELECT COUNT(*) as count FROM invitations
            `);
            stats.totalInvitations = invitationsRows[0].count;
            
            return stats;
            
        } catch (error) {
            console.error('Ошибка получения расширенной статистики:', error);
            return null;
        }
    }



    // Поиск пользователя по Telegram username
    async getMemberByUsername(username) {
        if (!this.checkConnection()) return null;
        
        try {
            // Убираем @ из начала если есть
            const cleanUsername = username.replace(/^@/, '');
            
            const [rows] = await this.connection.execute(
                'SELECT * FROM members WHERE nickname = ? AND status NOT IN ("вышел", "бан")',
                [cleanUsername]
            );
            
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка поиска пользователя по username:', error);
            return null;
        }
    }

    // Обновление статусов автомобилей при изменении статуса пользователя
    async updateCarStatusesByMemberStatus(memberId, memberStatus) {
        if (!this.checkConnection()) return { success: false, message: 'База данных недоступна' };
        
        try {
            let newCarStatus = null;
            let whereClause = 'WHERE member_id = ?';
            let params = [memberId];
            
            // Определяем новый статус автомобилей в зависимости от статуса пользователя
            if (memberStatus === 'активный') {
                // Пользователь стал активным → все его авто становятся активными
                newCarStatus = 'активный';
                whereClause += ' AND status IN ("на модерации", "неактивный")'; // Обновляем только те, что можно активировать
            } else if (memberStatus === 'вышел') {
                // Пользователь вышел → все его авто в статус "вышел"
                newCarStatus = 'вышел';
                whereClause += ' AND status != "вышел"'; // Обновляем все кроме уже вышедших
            } else if (memberStatus === 'участник' || memberStatus === 'без авто') {
                // Пользователь вернулся → все его авто на модерацию
                newCarStatus = 'на модерации';
                whereClause += ' AND status = "вышел"'; // Обновляем только вышедшие авто
            }
            
            if (!newCarStatus) {
                return { success: true, updatedCars: 0 }; // Нет изменений для этого статуса
            }
            
            const [result] = await this.connection.execute(
                `UPDATE cars SET status = ? ${whereClause}`,
                [newCarStatus, ...params]
            );
            
            console.log(`🚗 Обновлено статусов автомобилей: ${result.affectedRows} (пользователь ${memberId}, статус: ${memberStatus} → авто: ${newCarStatus})`);
            
            return {
                success: true,
                updatedCars: result.affectedRows,
                newCarStatus: newCarStatus
            };
            
        } catch (error) {
            console.error('Ошибка обновления статусов автомобилей:', error);
            return { success: false, message: 'Ошибка базы данных' };
        }
    }

    // Обновление статуса пользователя по Telegram ID
    async updateMemberStatus(telegramId, newStatus, adminId = null) {
        if (!this.checkConnection()) return { success: false, message: 'База данных недоступна' };
        
        try {
            // Сначала получаем текущую информацию о пользователе
            const member = await this.getMemberByTelegramId(telegramId);
            if (!member) {
                return { success: false, message: 'Пользователь не найден' };
            }

            const oldStatus = member.status;
            
            // Проверяем, что статус действительно изменяется
            if (oldStatus === newStatus) {
                return { 
                    success: false, 
                    message: `Пользователь уже имеет статус "${newStatus}"` 
                };
            }

            // Обновляем статус
            const [result] = await this.connection.execute(
                'UPDATE members SET status = ? WHERE telegram_id = ?',
                [newStatus, telegramId]
            );

            if (result.affectedRows > 0) {
                console.log(`🔄 Статус пользователя ${member.first_name} (${telegramId}) изменен: ${oldStatus} → ${newStatus} (админ: ${adminId})`);
                
                // Автоматически обновляем статусы автомобилей
                const carUpdateResult = await this.updateCarStatusesByMemberStatus(member.id, newStatus);
                
                return {
                    success: true,
                    member: {
                        id: member.id,
                        telegram_id: telegramId,
                        first_name: member.first_name,
                        last_name: member.last_name,
                        nickname: member.nickname,
                        old_status: oldStatus,
                        new_status: newStatus
                    },
                    carUpdate: carUpdateResult
                };
            } else {
                return { success: false, message: 'Не удалось обновить статус' };
            }
        } catch (error) {
            console.error('Ошибка обновления статуса пользователя:', error);
            return { success: false, message: 'Ошибка базы данных' };
        }
    }
    // =====================================================
    // 🎉 Методы для работы с событиями (events)
    // =====================================================

    async getAllEvents() {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT e.*, m.first_name, m.last_name, m.nickname
                FROM events e
                LEFT JOIN members m ON e.organizer_id = m.id
                ORDER BY e.event_date DESC, e.event_time DESC
            `);
            return rows;
        } catch (error) {
            console.error('Ошибка получения событий:', error);
            return [];
        }
    }

    async getEventById(eventId) {
        if (!this.checkConnection()) return null;
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT e.*, m.first_name, m.last_name, m.nickname
                FROM events e
                LEFT JOIN members m ON e.organizer_id = m.id
                WHERE e.id = ?
            `, [eventId]);
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка получения события по ID:', error);
            return null;
        }
    }

    async getEventsByOrganizer(organizerId) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT e.*, m.first_name, m.last_name, m.nickname
                FROM events e
                LEFT JOIN members m ON e.organizer_id = m.id
                WHERE e.organizer_id = ?
                ORDER BY e.event_date DESC
            `, [organizerId]);
            return rows;
        } catch (error) {
            console.error('Ошибка получения событий организатора:', error);
            return [];
        }
    }

    async createEvent(eventData) {
        if (!this.checkConnection()) {
            console.log('⚠️ Создание события пропущено - БД недоступна');
            return null;
        }
        
        try {
            const {
                title, description, event_date, event_time, location, city,
                type, status, organizer_id, max_participants, price, photos
            } = eventData;

            const [result] = await this.connection.execute(
                `INSERT INTO events (
                    title, description, event_date, event_time, location, city,
                    type, status, organizer_id, max_participants, price, photos
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    title,
                    description || null,
                    event_date,
                    event_time || null,
                    location,
                    city,
                    type || 'встреча',
                    status || 'запланировано',
                    organizer_id,
                    max_participants || null,
                    price || 0.00,
                    photos || null
                ]
            );

            console.log(`✅ Создано событие: ${title} (ID: ${result.insertId})`);
            return { id: result.insertId, ...eventData };
        } catch (error) {
            console.error('Ошибка создания события:', error);
            return null;
        }
    }

    async updateEvent(eventId, updates) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const fields = Object.keys(updates);
            const values = Object.values(updates);
            const setClause = fields.map(field => `${field} = ?`).join(', ');

            const [result] = await this.connection.execute(
                `UPDATE events SET ${setClause} WHERE id = ?`,
                [...values, eventId]
            );

            console.log(`📝 Обновлено событие ID ${eventId}: ${result.affectedRows} записей`);
            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка обновления события:', error);
            return { affectedRows: 0 };
        }
    }

    async deleteEvent(eventId) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const [result] = await this.connection.execute(
                'DELETE FROM events WHERE id = ?',
                [eventId]
            );

            console.log(`🗑️ Удалено событие ID ${eventId}: ${result.affectedRows} записей`);
            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка удаления события:', error);
            return { affectedRows: 0 };
        }
    }

    // =====================================================
    // 🔧 Методы для работы с сервисами (services)
    // =====================================================

    async getAllServices() {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT s.*, m.first_name, m.last_name, m.nickname
                FROM services s
                LEFT JOIN members m ON s.added_by_member_id = m.id
                ORDER BY s.recommendation DESC, s.rating DESC, s.created_at DESC
            `);
            return rows;
        } catch (error) {
            console.error('Ошибка получения сервисов:', error);
            return [];
        }
    }

    async getServiceById(serviceId) {
        if (!this.checkConnection()) return null;
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT s.*, m.first_name, m.last_name, m.nickname
                FROM services s
                LEFT JOIN members m ON s.added_by_member_id = m.id
                WHERE s.id = ?
            `, [serviceId]);
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Ошибка получения сервиса по ID:', error);
            return null;
        }
    }

    async getServicesByCity(city) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT s.*, m.first_name, m.last_name, m.nickname
                FROM services s
                LEFT JOIN members m ON s.added_by_member_id = m.id
                WHERE s.city = ?
                ORDER BY s.recommendation DESC, s.rating DESC
            `, [city]);
            return rows;
        } catch (error) {
            console.error('Ошибка получения сервисов по городу:', error);
            return [];
        }
    }

    async getServicesByType(type) {
        if (!this.checkConnection()) return [];
        
        try {
            const [rows] = await this.connection.execute(`
                SELECT s.*, m.first_name, m.last_name, m.nickname
                FROM services s
                LEFT JOIN members m ON s.added_by_member_id = m.id
                WHERE s.type = ?
                ORDER BY s.recommendation DESC, s.rating DESC
            `, [type]);
            return rows;
        } catch (error) {
            console.error('Ошибка получения сервисов по типу:', error);
            return [];
        }
    }

    async createService(serviceData) {
        if (!this.checkConnection()) {
            console.log('⚠️ Создание сервиса пропущено - БД недоступна');
            return null;
        }
        
        try {
            const {
                name, description, city, address, phone, website,
                type, recommendation, rating, reviews_count,
                services_list, price_range, working_hours,
                photos, added_by_member_id
            } = serviceData;

            const [result] = await this.connection.execute(
                `INSERT INTO services (
                    name, description, city, address, phone, website,
                    type, recommendation, rating, reviews_count,
                    services_list, price_range, working_hours,
                    photos, added_by_member_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name,
                    description || null,
                    city,
                    address || null,
                    phone || null,
                    website || null,
                    type || 'автосервис',
                    recommendation || 'нейтрально',
                    rating || null,
                    reviews_count || 0,
                    services_list || null,
                    price_range || null,
                    working_hours || null,
                    photos || null,
                    added_by_member_id || null
                ]
            );

            console.log(`✅ Создан сервис: ${name} (ID: ${result.insertId})`);
            return { id: result.insertId, ...serviceData };
        } catch (error) {
            console.error('Ошибка создания сервиса:', error);
            return null;
        }
    }

    async updateService(serviceId, updates) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const fields = Object.keys(updates);
            const values = Object.values(updates);
            const setClause = fields.map(field => `${field} = ?`).join(', ');

            const [result] = await this.connection.execute(
                `UPDATE services SET ${setClause} WHERE id = ?`,
                [...values, serviceId]
            );

            console.log(`📝 Обновлен сервис ID ${serviceId}: ${result.affectedRows} записей`);
            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка обновления сервиса:', error);
            return { affectedRows: 0 };
        }
    }

    async deleteService(serviceId) {
        if (!this.checkConnection()) return { affectedRows: 0 };
        
        try {
            const [result] = await this.connection.execute(
                'DELETE FROM services WHERE id = ?',
                [serviceId]
            );

            console.log(`🗑️ Удален сервис ID ${serviceId}: ${result.affectedRows} записей`);
            return { affectedRows: result.affectedRows };
        } catch (error) {
            console.error('Ошибка удаления сервиса:', error);
            return { affectedRows: 0 };
        }
    }
}

module.exports = new Database(); 