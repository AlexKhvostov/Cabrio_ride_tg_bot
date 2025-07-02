/**
 * Сервис для работы с участниками клуба
 */

const db = require('../database/database');
const { getMessage, formatDate, formatLocation, formatStatus, safeValue } = require('../utils/localization');

class MemberService {
    /**
     * Получить участника по Telegram ID
     * @param {number} telegramId - Telegram ID
     * @returns {object|null} Данные участника
     */
    async getMemberByTelegramId(telegramId) {
        try {
            return await db.getMemberByTelegramId(telegramId);
        } catch (error) {
            console.error('Ошибка получения участника:', error);
            throw error;
        }
    }

    /**
     * Создать нового участника
     * @param {object} memberData - Данные участника
     * @returns {object} Созданный участник
     */
    async createMember(memberData) {
        try {
            // Валидация данных
            this.validateMemberData(memberData);
            
            // Добавляем дату вступления
            memberData.join_date = new Date().toISOString().split('T')[0];
            
            return await db.createMember(memberData);
        } catch (error) {
            console.error('Ошибка создания участника:', error);
            throw error;
        }
    }

    /**
     * Обновить данные участника
     * @param {number} telegramId - Telegram ID
     * @param {object} updates - Обновления
     * @returns {object} Результат обновления
     */
    async updateMember(telegramId, updates) {
        try {
            return await db.updateMember(telegramId, updates);
        } catch (error) {
            console.error('Ошибка обновления участника:', error);
            throw error;
        }
    }

    /**
     * Форматировать информацию о профиле участника
     * @param {object} member - Данные участника
     * @returns {string} Отформатированная информация
     */
    formatMemberProfile(member) {
        return getMessage('profile.info', {
            firstName: safeValue(member.first_name),
            lastName: safeValue(member.last_name),
            nickname: safeValue(member.nickname),
            phone: safeValue(member.phone),
            country: safeValue(member.country),
            city: safeValue(member.city),
            joinDate: formatDate(member.join_date),
            status: formatStatus(member.status),
            about: safeValue(member.about)
        });
    }

    /**
     * Проверить, зарегистрирован ли участник
     * @param {number} telegramId - Telegram ID
     * @returns {boolean} true если зарегистрирован
     */
    async isRegistered(telegramId) {
        try {
            const member = await this.getMemberByTelegramId(telegramId);
            return member !== null;
        } catch (error) {
            console.error('Ошибка проверки регистрации:', error);
            return false;
        }
    }

    /**
     * Обработать выход участника из группы
     * @param {number} telegramId - Telegram ID
     * @returns {object} Информация об обновлении
     */
    async handleMemberLeft(telegramId) {
        try {
            const member = await this.getMemberByTelegramId(telegramId);
            if (!member) return null;

            // Устанавливаем статус "вышел" и дату выхода
            const leftDate = new Date().toISOString().split('T')[0];
            await this.updateMember(telegramId, {
                status: 'вышел',
                left_date: leftDate
            });

            // Получаем количество автомобилей для обновления их статуса
            const cars = await db.getCarsByMemberId(member.id);
            
            // Обновляем статус всех автомобилей участника
            for (const car of cars) {
                if (car.status === 'активный') {
                    await db.updateCar(car.id, { status: 'вышел' });
                }
            }

            return {
                member,
                carsCount: cars.length
            };
        } catch (error) {
            console.error('Ошибка обработки выхода участника:', error);
            throw error;
        }
    }

    /**
     * Обработать возвращение участника в группу
     * @param {number} telegramId - Telegram ID
     * @returns {object} Информация об обновлении
     */
    async handleMemberReturned(telegramId) {
        try {
            const member = await this.getMemberByTelegramId(telegramId);
            if (!member) return null;

            let restoredCars = 0;

            // Если участник был в статусе "вышел", восстанавливаем его
            if (member.status === 'вышел') {
                await this.updateMember(telegramId, {
                    status: 'активный',
                    left_date: null
                });

                // Восстанавливаем автомобили
                const cars = await db.getCarsByMemberId(member.id);
                for (const car of cars) {
                    if (car.status === 'вышел') {
                        await db.updateCar(car.id, { status: 'активный' });
                        restoredCars++;
                    }
                }

                return {
                    type: 'returned_to_club',
                    member,
                    restoredCars
                };
            }

            return {
                type: 'returned_to_chat',
                member,
                restoredCars: 0
            };
        } catch (error) {
            console.error('Ошибка обработки возвращения участника:', error);
            throw error;
        }
    }

    /**
     * Валидация данных участника
     * @param {object} memberData - Данные участника
     */
    validateMemberData(memberData) {
        if (!memberData.telegram_id) {
            throw new Error('Telegram ID обязателен');
        }
        
        if (!memberData.first_name || memberData.first_name.trim().length === 0) {
            throw new Error('Имя обязательно');
        }
        
        if (memberData.first_name.length > 50) {
            throw new Error('Имя слишком длинное (максимум 50 символов)');
        }
        
        if (memberData.last_name && memberData.last_name.length > 50) {
            throw new Error('Фамилия слишком длинная (максимум 50 символов)');
        }
        
        if (memberData.nickname && memberData.nickname.length > 50) {
            throw new Error('Никнейм слишком длинный (максимум 50 символов)');
        }
        
        if (memberData.phone && memberData.phone.length > 20) {
            throw new Error('Номер телефона слишком длинный (максимум 20 символов)');
        }
        
        if (memberData.email && memberData.email.length > 100) {
            throw new Error('Email слишком длинный (максимум 100 символов)');
        }
        
        if (memberData.country && memberData.country.length > 50) {
            throw new Error('Название страны слишком длинное (максимум 50 символов)');
        }
        
        if (memberData.city && memberData.city.length > 100) {
            throw new Error('Название города слишком длинное (максимум 100 символов)');
        }
    }

    /**
     * Получить статистику участников
     * @returns {object} Статистика
     */
    async getMemberStats() {
        try {
            const stats = await db.getStats();
            return {
                activeMembers: stats.activeMembers,
                leftMembers: stats.leftMembers,
                totalMembers: stats.activeMembers + stats.leftMembers
            };
        } catch (error) {
            console.error('Ошибка получения статистики участников:', error);
            throw error;
        }
    }
}

module.exports = new MemberService(); 