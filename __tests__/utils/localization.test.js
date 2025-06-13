/**
 * Тесты для утилиты локализации
 */

const { 
    getMessage, 
    formatMessage, 
    formatDate, 
    formatLocation, 
    formatEngine, 
    formatRoofType, 
    formatStatus, 
    safeValue 
} = require('../../src/utils/localization');

describe('Localization Utils', () => {
    describe('getMessage', () => {
        test('должен возвращать сообщение по ключу', () => {
            const message = getMessage('common.error');
            expect(message).toBe('❌ Произошла ошибка. Попробуйте позже.');
        });

        test('должен возвращать сообщение с параметрами', () => {
            const message = getMessage('start.existingUser', {
                name: 'Иван',
                status: 'активный',
                joinDate: '2024-01-01'
            });
            expect(message).toContain('Иван');
            expect(message).toContain('активный');
            expect(message).toContain('2024-01-01');
        });

        test('должен возвращать ошибку для несуществующего ключа', () => {
            const message = getMessage('nonexistent.key');
            expect(message).toBe('[MISSING: nonexistent.key]');
        });

        test('должен обрабатывать вложенные ключи', () => {
            const message = getMessage('menu.myProfile');
            expect(message).toBe('👤 Мой профиль');
        });
    });

    describe('formatMessage', () => {
        test('должен заменять параметры в шаблоне', () => {
            const template = 'Привет, {name}! Ваш статус: {status}';
            const result = formatMessage(template, { name: 'Иван', status: 'активный' });
            expect(result).toBe('Привет, Иван! Ваш статус: активный');
        });

        test('должен обрабатывать пустые параметры', () => {
            const template = 'Привет, {name}!';
            const result = formatMessage(template, { name: '' });
            expect(result).toBe('Привет, !');
        });

        test('должен обрабатывать отсутствующие параметры', () => {
            const template = 'Привет, {name}!';
            const result = formatMessage(template, { name: undefined });
            expect(result).toBe('Привет, !');
        });
    });

    describe('formatDate', () => {
        test('должен форматировать дату', () => {
            const date = new Date('2024-01-15');
            const result = formatDate(date);
            expect(result).toBe('15.01.2024');
        });

        test('должен обрабатывать строковую дату', () => {
            const result = formatDate('2024-01-15');
            expect(result).toBe('15.01.2024');
        });

        test('должен возвращать "Не указано" для null', () => {
            const result = formatDate(null);
            expect(result).toBe('Не указано');
        });

        test('должен возвращать "Неверная дата" для некорректной даты', () => {
            const result = formatDate('invalid-date');
            expect(result).toBe('Неверная дата');
        });
    });

    describe('formatLocation', () => {
        test('должен форматировать страну и город', () => {
            const result = formatLocation('Россия', 'Москва');
            expect(result).toBe('Россия, Москва');
        });

        test('должен обрабатывать только страну', () => {
            const result = formatLocation('Россия', null);
            expect(result).toBe('Россия');
        });

        test('должен обрабатывать только город', () => {
            const result = formatLocation(null, 'Москва');
            expect(result).toBe('Москва');
        });

        test('должен возвращать "Не указано" для пустых значений', () => {
            const result = formatLocation(null, null);
            expect(result).toBe('Не указано');
        });
    });

    describe('formatEngine', () => {
        test('должен форматировать объем и мощность', () => {
            const result = formatEngine(2.0, 150);
            expect(result).toBe('2л, 150 л.с.');
        });

        test('должен обрабатывать только объем', () => {
            const result = formatEngine(2.0, null);
            expect(result).toBe('2л');
        });

        test('должен обрабатывать только мощность', () => {
            const result = formatEngine(null, 150);
            expect(result).toBe('150 л.с.');
        });

        test('должен возвращать "Не указано" для пустых значений', () => {
            const result = formatEngine(null, null);
            expect(result).toBe('Не указано');
        });
    });

    describe('formatRoofType', () => {
        test('должен форматировать тип крыши', () => {
            expect(formatRoofType('soft')).toBe('Мягкая');
            expect(formatRoofType('hard')).toBe('Жесткая');
            expect(formatRoofType('targa')).toBe('Тарга');
        });

        test('должен возвращать исходное значение для неизвестного типа', () => {
            const result = formatRoofType('unknown');
            expect(result).toBe('unknown');
        });

        test('должен возвращать "Не указано" для null', () => {
            const result = formatRoofType(null);
            expect(result).toBe('Не указано');
        });
    });

    describe('formatStatus', () => {
        test('должен форматировать статусы', () => {
            expect(formatStatus('новый')).toBe('🆕 Новый');
            expect(formatStatus('активный')).toBe('✅ Активный');
            expect(formatStatus('вышел')).toBe('❌ Вышел');
        });

        test('должен возвращать исходное значение для неизвестного статуса', () => {
            const result = formatStatus('unknown');
            expect(result).toBe('unknown');
        });

        test('должен возвращать "Неизвестно" для null', () => {
            const result = formatStatus(null);
            expect(result).toBe('Неизвестно');
        });
    });

    describe('safeValue', () => {
        test('должен возвращать значение если оно есть', () => {
            expect(safeValue('test')).toBe('test');
            expect(safeValue(123)).toBe('123');
            expect(safeValue(true)).toBe('true');
        });

        test('должен возвращать значение по умолчанию для пустых значений', () => {
            expect(safeValue(null)).toBe('Не указано');
            expect(safeValue(undefined)).toBe('Не указано');
            expect(safeValue('')).toBe('Не указано');
        });

        test('должен использовать кастомное значение по умолчанию', () => {
            expect(safeValue(null, 'Пусто')).toBe('Пусто');
            expect(safeValue('', 'Нет данных')).toBe('Нет данных');
        });
    });
}); 