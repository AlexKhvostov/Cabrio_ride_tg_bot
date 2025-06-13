/**
 * Middleware для ограничения частоты запросов (Rate Limiting)
 */

const { getMessage } = require('../utils/localization');

class RateLimiter {
    constructor() {
        // Хранилище для отслеживания запросов пользователей
        this.userRequests = new Map();
        
        // Настройки лимитов
        this.limits = {
            // Общие команды - 10 запросов в минуту
            general: {
                maxRequests: 10,
                windowMs: 60 * 1000, // 1 минута
                commands: ['start', 'menu', 'profile', 'cars', 'stats', 'help']
            },
            
            // Регистрация и добавление данных - 5 запросов в 5 минут
            registration: {
                maxRequests: 5,
                windowMs: 5 * 60 * 1000, // 5 минут
                commands: ['register', 'addcar', 'invite']
            },
            
            // Поиск - 20 запросов в минуту
            search: {
                maxRequests: 20,
                windowMs: 60 * 1000, // 1 минута
                commands: ['search']
            },
            
            // Callback запросы - 30 запросов в минуту
            callback: {
                maxRequests: 30,
                windowMs: 60 * 1000, // 1 минута
                type: 'callback_query'
            }
        };
        
        // Очистка старых записей каждые 5 минут
        setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }

    /**
     * Проверка лимита для пользователя
     * @param {number} userId - ID пользователя
     * @param {string} command - Команда или тип запроса
     * @returns {boolean} true если запрос разрешен, false если превышен лимит
     */
    checkLimit(userId, command) {
        const now = Date.now();
        const userKey = `${userId}`;
        
        // Определяем тип лимита для команды
        const limitType = this.getLimitType(command);
        if (!limitType) return true; // Если лимит не настроен, разрешаем
        
        const limit = this.limits[limitType];
        const requestKey = `${userKey}:${limitType}`;
        
        // Получаем историю запросов пользователя
        if (!this.userRequests.has(requestKey)) {
            this.userRequests.set(requestKey, []);
        }
        
        const requests = this.userRequests.get(requestKey);
        
        // Удаляем старые запросы за пределами окна
        const validRequests = requests.filter(timestamp => 
            now - timestamp < limit.windowMs
        );
        
        // Проверяем лимит
        if (validRequests.length >= limit.maxRequests) {
            console.log(`Rate limit exceeded for user ${userId}, command ${command}`);
            return false;
        }
        
        // Добавляем текущий запрос
        validRequests.push(now);
        this.userRequests.set(requestKey, validRequests);
        
        return true;
    }

    /**
     * Определение типа лимита для команды
     * @param {string} command - Команда
     * @returns {string|null} Тип лимита
     */
    getLimitType(command) {
        for (const [limitType, config] of Object.entries(this.limits)) {
            if (config.commands && config.commands.includes(command)) {
                return limitType;
            }
            if (config.type && config.type === command) {
                return limitType;
            }
        }
        return 'general'; // По умолчанию общий лимит
    }

    /**
     * Получение информации о лимитах пользователя
     * @param {number} userId - ID пользователя
     * @returns {object} Информация о лимитах
     */
    getUserLimits(userId) {
        const now = Date.now();
        const userKey = `${userId}`;
        const limits = {};
        
        for (const [limitType, config] of Object.entries(this.limits)) {
            const requestKey = `${userKey}:${limitType}`;
            const requests = this.userRequests.get(requestKey) || [];
            
            const validRequests = requests.filter(timestamp => 
                now - timestamp < config.windowMs
            );
            
            limits[limitType] = {
                current: validRequests.length,
                max: config.maxRequests,
                resetTime: validRequests.length > 0 ? 
                    Math.max(...validRequests) + config.windowMs : now
            };
        }
        
        return limits;
    }

    /**
     * Очистка старых записей
     */
    cleanup() {
        const now = Date.now();
        const maxWindowMs = Math.max(...Object.values(this.limits).map(l => l.windowMs));
        
        for (const [key, requests] of this.userRequests.entries()) {
            const validRequests = requests.filter(timestamp => 
                now - timestamp < maxWindowMs
            );
            
            if (validRequests.length === 0) {
                this.userRequests.delete(key);
            } else {
                this.userRequests.set(key, validRequests);
            }
        }
        
        console.log(`Rate limiter cleanup: ${this.userRequests.size} active users`);
    }

    /**
     * Сброс лимитов для пользователя (для админов)
     * @param {number} userId - ID пользователя
     */
    resetUserLimits(userId) {
        const userKey = `${userId}`;
        
        for (const limitType of Object.keys(this.limits)) {
            const requestKey = `${userKey}:${limitType}`;
            this.userRequests.delete(requestKey);
        }
        
        console.log(`Rate limits reset for user ${userId}`);
    }

    /**
     * Middleware функция для проверки лимитов
     * @param {string} command - Команда или тип запроса
     * @returns {function} Middleware функция
     */
    middleware(command) {
        return (req, res, next) => {
            const userId = req.userId || req.from?.id;
            
            if (!userId) {
                return next();
            }
            
            if (!this.checkLimit(userId, command)) {
                req.rateLimitExceeded = true;
                req.rateLimitMessage = getMessage('common.rateLimitExceeded');
                return next();
            }
            
            next();
        };
    }
}

// Создаем единственный экземпляр rate limiter
const rateLimiter = new RateLimiter();

/**
 * Проверка rate limit для Telegram сообщений
 * @param {object} msg - Telegram сообщение
 * @param {string} command - Команда
 * @returns {boolean} true если запрос разрешен
 */
function checkRateLimit(msg, command) {
    const userId = msg.from.id;
    return rateLimiter.checkLimit(userId, command);
}

/**
 * Отправка сообщения о превышении лимита
 * @param {object} bot - Экземпляр бота
 * @param {number} chatId - ID чата
 */
function sendRateLimitMessage(bot, chatId) {
    bot.sendMessage(chatId, getMessage('common.rateLimitExceeded'));
}

module.exports = {
    RateLimiter,
    rateLimiter,
    checkRateLimit,
    sendRateLimitMessage
}; 