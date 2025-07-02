/**
 * 🔧 Модуль управления настройками уведомлений бота
 */

const fs = require('fs');
const path = require('path');

class OptionsManager {
    constructor() {
        this.optionsFile = path.join(__dirname, '../../options.json');
        this.options = null;
        this.lastModified = null;
        this.loadOptions();
    }

    /**
     * 📂 Загрузка настроек из файла
     */
    loadOptions() {
        try {
            if (fs.existsSync(this.optionsFile)) {
                const data = fs.readFileSync(this.optionsFile, 'utf8');
                this.options = JSON.parse(data);
                
                // Запоминаем время последнего изменения файла
                const stats = fs.statSync(this.optionsFile);
                this.lastModified = stats.mtime;
                
                console.log('✅ Настройки загружены из options.json');
            } else {
                console.log('⚠️ Файл options.json не найден, используем настройки по умолчанию');
                this.createDefaultOptions();
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки настроек:', error.message);
            this.createDefaultOptions();
        }
    }

    /**
     * 🔄 Автоматическая перезагрузка настроек при изменении файла
     */
    checkForUpdates() {
        if (!this.options || !this.options.settings.auto_reload) {
            return false;
        }

        try {
            if (fs.existsSync(this.optionsFile)) {
                const stats = fs.statSync(this.optionsFile);
                if (stats.mtime > this.lastModified) {
                    console.log('🔄 Обнаружены изменения в options.json, перезагружаем...');
                    this.loadOptions();
                    return true;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка проверки обновлений настроек:', error.message);
        }
        return false;
    }

    /**
     * 🏗️ Создание настроек по умолчанию
     */
    createDefaultOptions() {
        this.options = {
            notifications: {
                new_member: { enabled: 1, description: "Уведомления о новых участниках клуба" },
                new_invitation: { enabled: 1, description: "Уведомления о новых приглашениях" },
                new_car: { enabled: 1, description: "Уведомления о добавлении новых автомобилей" },
                member_left: { enabled: 1, description: "Уведомления о выходе участников" },
                system_messages: { enabled: 1, description: "Системные сообщения и приветствия" }
            },
            settings: {
                auto_reload: 1,
                description: "Автоматическая перезагрузка настроек"
            },
            version: "1.0",
            last_updated: new Date().toISOString().split('T')[0]
        };
    }

    /**
     * ✅ Проверка, включен ли определенный тип уведомлений
     * @param {string} notificationType - Тип уведомления
     * @returns {boolean}
     */
    isNotificationEnabled(notificationType) {
        // Автоматически проверяем обновления при каждом запросе
        this.checkForUpdates();

        if (!this.options || !this.options.notifications) {
            return true; // По умолчанию включено
        }

        const notification = this.options.notifications[notificationType];
        if (!notification) {
            console.log(`⚠️ Неизвестный тип уведомления: ${notificationType}`);
            return true; // По умолчанию включено для неизвестных типов
        }

        const enabled = notification.enabled === 1;
        console.log(`🔍 Проверка уведомления "${notificationType}": ${enabled ? '✅ включено' : '❌ выключено'}`);
        return enabled;
    }

    /**
     * 📊 Получение всех настроек
     */
    getAllOptions() {
        this.checkForUpdates();
        return this.options;
    }

    /**
     * 📝 Получение описания настройки
     */
    getNotificationDescription(notificationType) {
        if (!this.options || !this.options.notifications || !this.options.notifications[notificationType]) {
            return 'Описание недоступно';
        }
        return this.options.notifications[notificationType].description;
    }

    /**
     * 📋 Получение статуса всех уведомлений для отображения
     */
    getNotificationStatus() {
        this.checkForUpdates();
        
        if (!this.options || !this.options.notifications) {
            return 'Настройки недоступны';
        }

        let status = '🔧 Статус уведомлений:\n\n';
        
        Object.keys(this.options.notifications).forEach(key => {
            const notification = this.options.notifications[key];
            const icon = notification.enabled === 1 ? '✅' : '❌';
            status += `${icon} ${notification.description}\n`;
        });

        status += `\n📁 Файл настроек: options.json`;
        status += `\n🔄 Автоперезагрузка: ${this.options.settings.auto_reload === 1 ? '✅' : '❌'}`;

        return status;
    }
}

// Создаем единственный экземпляр
const optionsManager = new OptionsManager();

module.exports = optionsManager; 