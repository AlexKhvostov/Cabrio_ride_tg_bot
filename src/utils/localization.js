/**
 * Утилита для работы с локализацией
 */

const messages = require('../locales/ru');

/**
 * Получить локализованное сообщение по ключу
 * @param {string} key - Ключ сообщения (например: 'common.error')
 * @param {object} params - Параметры для подстановки
 * @returns {string} Локализованное сообщение
 */
function getMessage(key, params = {}) {
    try {
        const keys = key.split('.');
        let message = messages;
        
        for (const k of keys) {
            if (message[k] === undefined) {
                console.error(`Локализация: ключ "${key}" не найден`);
                return `[MISSING: ${key}]`;
            }
            message = message[k];
        }
        
        // Подстановка параметров
        if (typeof message === 'string' && Object.keys(params).length > 0) {
            return formatMessage(message, params);
        }
        
        return message;
    } catch (error) {
        console.error('Ошибка получения локализации:', error);
        return `[ERROR: ${key}]`;
    }
}

/**
 * Форматирование сообщения с подстановкой параметров
 * @param {string} template - Шаблон сообщения
 * @param {object} params - Параметры для подстановки
 * @returns {string} Отформатированное сообщение
 */
function formatMessage(template, params) {
    let result = template;
    
    for (const [key, value] of Object.entries(params)) {
        const placeholder = `{${key}}`;
        const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
        result = result.replace(new RegExp(escapedPlaceholder, 'g'), value !== undefined ? value : '');
    }
    
    return result;
}

/**
 * Форматирование даты для отображения
 * @param {Date|string} date - Дата
 * @returns {string} Отформатированная дата
 */
function formatDate(date) {
    if (!date) return 'Не указано';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Неверная дата';
    
    return d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

/**
 * Форматирование информации о местоположении
 * @param {string} country - Страна
 * @param {string} city - Город
 * @returns {string} Отформатированное местоположение
 */
function formatLocation(country, city) {
    const parts = [];
    if (country) parts.push(country);
    if (city) parts.push(city);
    return parts.length > 0 ? parts.join(', ') : 'Не указано';
}

/**
 * Форматирование информации о двигателе
 * @param {number} volume - Объем двигателя
 * @param {number} power - Мощность двигателя
 * @returns {string} Отформатированная информация о двигателе
 */
function formatEngine(volume, power) {
    const parts = [];
    if (volume) parts.push(`${volume}л`);
    if (power) parts.push(`${power} л.с.`);
    return parts.length > 0 ? parts.join(', ') : 'Не указано';
}

/**
 * Форматирование типа крыши
 * @param {string} roofType - Тип крыши
 * @returns {string} Отформатированный тип крыши
 */
function formatRoofType(roofType) {
    const types = {
        'soft': 'Мягкая',
        'hard': 'Жесткая',
        'targa': 'Тарга'
    };
    return types[roofType] || roofType || 'Не указано';
}

/**
 * Форматирование статуса
 * @param {string} status - Статус
 * @returns {string} Отформатированный статус
 */
function formatStatus(status) {
    const statuses = {
        'новый': '🆕 Новый',
        'активный': '✅ Активный',
        'вышел': '❌ Вышел',
        'без авто': '🚫 Без авто',
        'invite': '📨 Приглашение',
        'продан': '💰 Продан',
        'в ремонте': '🔧 В ремонте',
        'разбит': '💥 Разбит',
        'приглашение': '📨 Приглашение'
    };
    return statuses[status] || status || 'Неизвестно';
}

/**
 * Безопасное отображение значения
 * @param {any} value - Значение
 * @param {string} defaultValue - Значение по умолчанию
 * @returns {string} Безопасное значение
 */
function safeValue(value, defaultValue = 'Не указано') {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    return String(value);
}

module.exports = {
    getMessage,
    formatMessage,
    formatDate,
    formatLocation,
    formatEngine,
    formatRoofType,
    formatStatus,
    safeValue
}; 