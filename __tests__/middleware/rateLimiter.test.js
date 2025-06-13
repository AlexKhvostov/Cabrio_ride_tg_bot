/**
 * Тесты для Rate Limiter
 */

const { RateLimiter, checkRateLimit } = require('../../src/middleware/rateLimiter');

describe('Rate Limiter', () => {
    let rateLimiter;

    beforeEach(() => {
        rateLimiter = new RateLimiter();
        // Устанавливаем более низкие лимиты для тестов
        rateLimiter.limits = {
            general: {
                maxRequests: 3,
                windowMs: 1000, // 1 секунда
                commands: ['start', 'menu']
            },
            registration: {
                maxRequests: 2,
                windowMs: 2000, // 2 секунды
                commands: ['register']
            }
        };
    });

    afterEach(() => {
        // Очищаем состояние после каждого теста
        rateLimiter.userRequests.clear();
        // Очищаем все таймеры
        jest.clearAllTimers();
    });

    describe('checkLimit', () => {
        test('должен разрешать запросы в пределах лимита', () => {
            const userId = 123;
            
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
        });

        test('должен блокировать запросы при превышении лимита', () => {
            const userId = 123;
            
            // Исчерпываем лимит
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            
            // Следующий запрос должен быть заблокирован
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(false);
        });

        test('должен использовать разные лимиты для разных команд', () => {
            const userId = 123;
            
            // Исчерпываем лимит для general команд
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'menu')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'menu')).toBe(false);
            
            // Но registration команды должны работать
            expect(rateLimiter.checkLimit(userId, 'register')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'register')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'register')).toBe(false);
        });

        test('должен использовать отдельные лимиты для разных пользователей', () => {
            const userId1 = 123;
            const userId2 = 456;
            
            // Исчерпываем лимит для первого пользователя
            expect(rateLimiter.checkLimit(userId1, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId1, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId1, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId1, 'start')).toBe(false);
            
            // Второй пользователь должен иметь свой лимит
            expect(rateLimiter.checkLimit(userId2, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId2, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId2, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId2, 'start')).toBe(false);
        });

        test('должен сбрасывать лимит после истечения времени', async () => {
            const userId = 123;
            
            // Исчерпываем лимит
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(false);
            
            // Ждем истечения времени окна
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Лимит должен сброситься
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
        }, 2000);
    });

    describe('getLimitType', () => {
        test('должен определять правильный тип лимита', () => {
            expect(rateLimiter.getLimitType('start')).toBe('general');
            expect(rateLimiter.getLimitType('menu')).toBe('general');
            expect(rateLimiter.getLimitType('register')).toBe('registration');
            expect(rateLimiter.getLimitType('unknown')).toBe('general');
        });
    });

    describe('getUserLimits', () => {
        test('должен возвращать информацию о лимитах пользователя', () => {
            const userId = 123;
            
            // Делаем несколько запросов
            rateLimiter.checkLimit(userId, 'start');
            rateLimiter.checkLimit(userId, 'register');
            
            const limits = rateLimiter.getUserLimits(userId);
            
            expect(limits.general.current).toBe(1);
            expect(limits.general.max).toBe(3);
            expect(limits.registration.current).toBe(1);
            expect(limits.registration.max).toBe(2);
        });
    });

    describe('resetUserLimits', () => {
        test('должен сбрасывать лимиты пользователя', () => {
            const userId = 123;
            
            // Исчерпываем лимит
            rateLimiter.checkLimit(userId, 'start');
            rateLimiter.checkLimit(userId, 'start');
            rateLimiter.checkLimit(userId, 'start');
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(false);
            
            // Сбрасываем лимиты
            rateLimiter.resetUserLimits(userId);
            
            // Лимит должен сброситься
            expect(rateLimiter.checkLimit(userId, 'start')).toBe(true);
        });
    });

    describe('cleanup', () => {
        test('должен очищать старые записи', async () => {
            const userId = 123;
            
            // Делаем запрос
            rateLimiter.checkLimit(userId, 'start');
            expect(rateLimiter.userRequests.size).toBeGreaterThan(0);
            
            // Ждем истечения времени
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Запускаем очистку
            rateLimiter.cleanup();
            
            // Проверяем что записи очищены или содержат только пустые массивы
            let hasActiveRequests = false;
            for (const [key, requests] of rateLimiter.userRequests.entries()) {
                if (requests.length > 0) {
                    hasActiveRequests = true;
                    break;
                }
            }
            expect(hasActiveRequests).toBe(false);
        }, 2000);
    });
});

describe('checkRateLimit function', () => {
    test('должен проверять лимит для Telegram сообщения', () => {
        const msg = {
            from: { id: 123 }
        };
        
        // Первые запросы должны проходить
        expect(checkRateLimit(msg, 'start')).toBe(true);
        expect(checkRateLimit(msg, 'start')).toBe(true);
    });
}); 