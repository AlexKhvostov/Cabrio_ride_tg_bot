const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const db = require('../database/database');
const { formatDate } = require('../utils/localization');
const { createAPI } = require('../api/api');
const optionsManager = require('../utils/options');
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [];

// Отладочная информация о загрузке админов
console.log('🔧 Диагностика загрузки ADMIN_IDS:');
console.log('   process.env.ADMIN_IDS:', process.env.ADMIN_IDS);
console.log('   ADMIN_IDS массив:', ADMIN_IDS);
console.log('   Количество админов:', ADMIN_IDS.length);

// Создаём экземпляр бота
const bot = new TelegramBot(config.BOT_TOKEN, { 
    polling: true,
    // Подавляем deprecation warning для отправки файлов
    filepath: false
});

// Состояния пользователей для многошаговых операций
const userStates = new Map();

// Система временных паролей для получения активного статуса
let activePassword = null;
let passwordTimer = null;
const PASSWORD_LIFETIME = 10 * 60 * 1000; // 10 минут в миллисекундах

// Функции для уведомлений в группу
async function sendGroupNotification(message, options = {}, notificationType = null) {
    // Проверяем настройки уведомлений
    if (notificationType && !optionsManager.isNotificationEnabled(notificationType)) {
        console.log(`🔕 Уведомление "${notificationType}" отключено в настройках`);
        return;
    }
    
    try {
        console.log('📤 Отправляем уведомление в группу:', config.CHAT_ID);
        console.log('📝 Сообщение:', message.substring(0, 100) + '...');
        
        await bot.sendMessage(config.CHAT_ID, message, {
            parse_mode: 'Markdown',
            ...options
        });
        
        console.log('✅ Уведомление отправлено успешно');
    } catch (error) {
        console.error('❌ Ошибка отправки уведомления в группу:', error);
        console.error('Детали ошибки:', error.message);
        
        // Если ошибка связана с тем, что бот не в группе
        if (error.response && error.response.body && error.response.body.error_code === 403) {
            console.error('🚫 Бот не является участником группы или не имеет прав на отправку сообщений');
        }
        
        throw error; // Пробрасываем ошибку дальше
    }
}

async function sendGroupPhoto(photoPath, caption, options = {}, notificationType = null) {
    // Проверяем настройки уведомлений
    if (notificationType && !optionsManager.isNotificationEnabled(notificationType)) {
        console.log(`🔕 Уведомление с фото "${notificationType}" отключено в настройках`);
        return;
    }
    
    try {
        console.log('📸 Отправляем фото в группу:');
        console.log('   Photo Path:', photoPath);
        console.log('   Caption:', caption);
        console.log('   Chat ID:', config.CHAT_ID);
        
        // Проверяем, является ли photoPath файлом или URL
        let photoSource;
        if (photoPath && photoPath.startsWith('http')) {
            // Это URL
            photoSource = photoPath;
            console.log('📡 Используем URL для фото:', photoSource);
        } else {
            // Это локальный файл
            const fullPath = path.resolve(photoPath);
            console.log('   Полный путь к файлу:', fullPath);
            console.log('   Файл существует:', fs.existsSync(fullPath));
            
            if (!photoPath || !fs.existsSync(fullPath)) {
                console.error('❌ Файл не найден:', fullPath);
                // Отправляем только текст без фото
                await sendGroupNotification(caption, options, notificationType);
                return;
            }
            
            photoSource = fs.createReadStream(fullPath);
            console.log('📁 Используем локальный файл:', fullPath);
        }
        
        console.log('   Отправляем фото...');
        await bot.sendPhoto(config.CHAT_ID, photoSource, {
            caption: caption,
            parse_mode: 'Markdown',
            contentType: 'image/jpeg',
            ...options
        });
        
        console.log('✅ Фото отправлено успешно');
    } catch (error) {
        console.error('❌ Ошибка отправки фото в группу:');
        console.error('   Photo Path:', photoPath);
        console.error('   Error Message:', error.message);
        console.error('   Full Error:', error);
        
        // Если не удалось отправить фото, отправляем только текст
        try {
            await sendGroupNotification(caption, options, notificationType);
            console.log('✅ Отправлено текстовое уведомление вместо фото');
        } catch (fallbackError) {
            console.error('❌ Ошибка отправки резервного уведомления:', fallbackError);
        }
    }
}

// Проверка членства в чате
// Проверка членства в чате (оставляем для совместимости)
async function checkChatMembership(userId) {
    return await checkUserMembership(userId);
}

// Проверка статуса бота в группе
async function checkBotGroupStatus() {
    try {
        const botInfo = await bot.getMe();
        const botMember = await bot.getChatMember(config.CHAT_ID, botInfo.id);
        return {
            isInGroup: ['member', 'administrator', 'creator'].includes(botMember.status),
            status: botMember.status,
            canSendMessages: botMember.status === 'administrator' || botMember.status === 'creator' || 
                           (botMember.status === 'member' && !botMember.is_restricted)
        };
    } catch (error) {
        console.error('Ошибка проверки статуса бота в группе:', error);
        return {
            isInGroup: false,
            status: 'unknown',
            canSendMessages: false
        };
    }
}

// Проверка членства пользователя в чате
async function checkUserMembership(userId) {
    try {
        const member = await bot.getChatMember(config.CHAT_ID, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        console.error('Ошибка проверки членства пользователя в чате:', error.message);
        
        // Детальная обработка различных типов ошибок
        if (error.response && error.response.body) {
            const errorBody = error.response.body;
            
            if (errorBody.error_code === 400 && errorBody.description === 'Bad Request: chat not found') {
                console.error('🚫 КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ:');
                console.error(`   CHAT_ID: ${config.CHAT_ID}`);
                console.error('   Причины:');
                console.error('   1. Неправильный CHAT_ID в .env файле');
                console.error('   2. Группа не существует');
                console.error('   3. Бот не добавлен в группу');
                console.error('   4. Группа была удалена');
                console.error('');
                console.error('💡 Решение:');
                console.error('   1. Проверьте CHAT_ID в .env файле');
                console.error('   2. Убедитесь что бот добавлен в группу');
                console.error('   3. Получите правильный CHAT_ID группы');
                
                // Если это админ - показываем детальную ошибку
                if (ADMIN_IDS.includes(userId)) {
                    return 'config_error';
                }
                
                return false;
            } else if (errorBody.error_code === 403) {
                console.error('🔒 Бот не имеет прав на получение информации о участниках группы');
                return false;
            }
        }
        
        return false;
    }
}

// Проверка доступности базы данных с уведомлением пользователя
async function checkDatabaseAccess(chatId) {
    if (!db.isConnected) {
        const errorMessage = '🚫 База данных недоступна\n\n' +
            'В данный момент база данных не отвечает.\n' +
            'Пожалуйста, сообщите об этой проблеме администраторам.\n\n' +
            '👥 Администраторы: ' + ADMIN_IDS.map(id => `[${id}](tg://user?id=${id})`).join(', ');
        
        await bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
        return false;
    }
    return true;
}

// Функция автоматического создания записи пользователя при первом обращении
async function ensureUserExists(msg) {
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    const lastName = msg.from.last_name;
    const username = msg.from.username;
    
    try {
        // Проверяем, есть ли пользователь в базе
        const existingMember = await db.getMemberByTelegramId(userId);
        
        if (!existingMember) {
            // Создаем базовую запись с минимальными данными из Telegram
            const newMemberData = {
                telegram_id: userId,
                first_name: firstName, // Имя из Telegram (может быть изменено при регистрации)
                nickname: username || null,
                status: 'новый', // Статус "новый" - обратился к боту, но не зарегистрирован
                join_date: new Date().toISOString().split('T')[0]
            };
            
            // НЕ сохраняем аватарку и last_name для статуса "новый"
            // Эти данные будут заполнены только при регистрации
            
            const createdMember = await db.createMember(newMemberData);
            if (createdMember) {
                console.log(`✅ Создана запись для нового пользователя: ${firstName} (${userId}) со статусом "новый"`);
                return createdMember;
            }
        }
        
        return existingMember;
    } catch (error) {
        console.error('Ошибка создания записи пользователя:', error);
        return null;
    }
}

// Middleware для проверки доступа (только членство в группе) + автоматическое создание записи
async function checkAccess(msg) {
    const userId = msg.from.id;
    const membershipResult = await checkUserMembership(userId);
    
    // Обработка ошибки конфигурации для админов
    if (membershipResult === 'config_error') {
        bot.sendMessage(msg.chat.id, 
            '🚫 КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ\n\n' +
            '❌ Группа не найдена (chat not found)\n\n' +
            'Возможные причины:\n' +
            `• Неправильный CHAT_ID: \`${config.CHAT_ID}\`\n` +
            '• Группа не существует или была удалена\n' +
            '• Бот не добавлен в группу\n\n' +
            'Что делать:\n' +
            '1️⃣ Проверить CHAT_ID в .env файле\n' +
            '2️⃣ Добавить бота в группу как администратора\n' +
            '3️⃣ Получить правильный CHAT_ID группы\n\n' +
            '🔧 Обратитесь к техническому администратору',
            { parse_mode: 'Markdown' }
        );
        return false;
    }
    
    if (!membershipResult) {
        bot.sendMessage(msg.chat.id, 
            '❌ Доступ запрещён!\n\n' +
            'Этот бот доступен только участникам клуба кабриолетов.\n\n' +
            '🚗 Присоединяйтесь к нашей группе:\n' +
            `👥 [${config.CLUB.groupLink}](${config.CLUB.groupLink})\n\n` +
            'После вступления в группу все функции бота станут доступны!',
            { parse_mode: 'Markdown' }
        );
        return false;
    }
    
    // Если пользователь в группе, автоматически создаем запись если её нет
    await ensureUserExists(msg);
    
    return true;
}

// Middleware для команд, требующих отправки в группу
async function checkGroupAccess(msg) {
    const userId = msg.from.id;
    
    // Проверяем членство пользователя
    const membershipResult = await checkUserMembership(userId);
    
    // Обработка ошибки конфигурации для админов
    if (membershipResult === 'config_error') {
        bot.sendMessage(msg.chat.id, 
            '🚫 КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ\n\n' +
            '❌ Группа не найдена (chat not found)\n\n' +
            'Возможные причины:\n' +
            `• Неправильный CHAT_ID: \`${config.CHAT_ID}\`\n` +
            '• Группа не существует или была удалена\n' +
            '• Бот не добавлен в группу\n\n' +
            'Что делать:\n' +
            '1️⃣ Проверить CHAT_ID в .env файле\n' +
            '2️⃣ Добавить бота в группу как администратора\n' +
            '3️⃣ Получить правильный CHAT_ID группы\n\n' +
            '🔧 Обратитесь к техническому администратору',
            { parse_mode: 'Markdown' }
        );
        return false;
    }
    
    if (!membershipResult) {
        bot.sendMessage(msg.chat.id, 
            '❌ Доступ запрещён!\n\n' +
            'Этот бот доступен только участникам клуба кабриолетов.\n\n' +
            '🚗 Присоединяйтесь к нашей группе:\n' +
            `👥 [${config.CLUB.groupLink}](${config.CLUB.groupLink})\n\n` +
            'После вступления в группу все функции бота станут доступны!',
            { parse_mode: 'Markdown' }
        );
        return false;
    }
    
    // Проверяем статус бота в группе
    const botStatus = await checkBotGroupStatus();
    if (!botStatus.isInGroup || !botStatus.canSendMessages) {
        bot.sendMessage(msg.chat.id, 
            '⚠️ Ограниченный функционал\n\n' +
            'Бот не находится в группе или не имеет прав на отправку сообщений.\n' +
            'Уведомления в группу отправлены не будут.\n\n' +
            '🔧 Обратитесь к администраторам для исправления этой проблемы.',
            { parse_mode: 'Markdown' }
        );
        return 'limited'; // Возвращаем специальное значение для ограниченного доступа
    }
    
    return true;
}

// Создание директорий для загрузки файлов
function createUploadDirs() {
    const dirs = [
        config.UPLOADS.membersPath,
        config.UPLOADS.carsPath
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log('✅ Создана директория:', dir);
        }
    });
}


// функция проверки админа 
function isAdmin(userId) {
    console.log(`🔍 Проверка админских прав для ID: ${userId}`);
    console.log(`🔧 Список админов: [${ADMIN_IDS.join(', ')}]`);
    const isAdminUser = ADMIN_IDS.includes(userId);
    console.log(`✅ Результат проверки: ${isAdminUser}`);
    return isAdminUser;
}

// Функция для добавления кнопки "Назад в меню" к клавиатуре
function addBackToMenuButton(keyboard) {
    if (!keyboard) {
        keyboard = { reply_markup: { inline_keyboard: [] } };
    }
    if (!keyboard.reply_markup) {
        keyboard.reply_markup = { inline_keyboard: [] };
    }
    if (!keyboard.reply_markup.inline_keyboard) {
        keyboard.reply_markup.inline_keyboard = [];
    }
    
    // Добавляем кнопку "Назад в меню" в последний ряд
    keyboard.reply_markup.inline_keyboard.push([
        { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
    ]);
    
    return keyboard;
}

// Функции для работы с временными паролями
function setActivePassword(password) {
    activePassword = password;
    console.log('🔐 Установлен временный пароль для получения активного статуса');
    
    // Очищаем предыдущий таймер если он есть
    if (passwordTimer) {
        clearTimeout(passwordTimer);
    }
    
    // Устанавливаем новый таймер на 10 минут
    passwordTimer = setTimeout(() => {
        activePassword = null;
        passwordTimer = null;
        console.log('⏰ Временный пароль истёк и был удалён');
    }, PASSWORD_LIFETIME);
    
    console.log('⏰ Пароль будет активен 10 минут');
}

function clearActivePassword() {
    activePassword = null;
    if (passwordTimer) {
        clearTimeout(passwordTimer);
        passwordTimer = null;
    }
    console.log('🗑️ Временный пароль очищен администратором');
}

function isPasswordActive() {
    return activePassword !== null;
}

function checkPassword(inputPassword) {
    return activePassword && activePassword === inputPassword;
}

function getPasswordTimeLeft() {
    if (!passwordTimer) return 0;
    // Приблизительное время, так как точное время сложно вычислить
    return Math.ceil(PASSWORD_LIFETIME / 60000); // в минутах
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    
    try {
        // Проверяем, есть ли пользователь в базе (должен быть создан автоматически в checkAccess)
        const existingMember = await db.getMemberByTelegramId(userId);
        
        if (existingMember) {
            if (existingMember.status === 'новый') {
                // Пользователь впервые обращается к боту
                bot.sendMessage(msg.chat.id, 
                    `🚗 ${config.CLUB.welcomeMessage}\n\n` +
                    `Привет, ${firstName}! Добро пожаловать в клуб кабриолетов!\n\n` +
                    `📊 Ваш статус: ${existingMember.status}\n\n` +
                    'Для полноценного участия в клубе пройдите регистрацию:\n' +
                    '👇 Используйте /register для заполнения анкеты.'
                );
            } else {
                // Пользователь уже зарегистрирован
                bot.sendMessage(msg.chat.id, 
                    `👋 С возвращением, ${existingMember.first_name}!\n\n` +
                    `📊 Статус: ${existingMember.status}\n` +
                    `📅 Дата вступления: ${formatDate(existingMember.join_date)}\n\n` +
                    'Используйте /menu для просмотра доступных команд.'
                );
            }
        } else {
            // Резервный случай - если автоматическое создание не сработало
            bot.sendMessage(msg.chat.id, 
                `🚗 ${config.CLUB.welcomeMessage}\n\n` +
                `Привет, ${firstName}! Произошла ошибка при создании вашей записи.\n` +
                'Попробуйте ещё раз или обратитесь к администратору.'
            );
        }
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

const os = require('os'); // Для системной информации (если понадобится)

// Команда /status - системная диагностика (только для администраторов)
bot.onText(/\/status/, async (msg) => {
    const userId = msg.from.id;
    
    // Только проверка админских прав, без проверки группы
    if (!isAdmin(userId)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещён! Команда доступна только администраторам.');
        return;
    }
    
    try {
        let statusMessage = '🔧 Системная диагностика бота\n\n';
        
        // 1. Проверка переменных окружения
        statusMessage += '⚙️ Конфигурация:\n';
        statusMessage += `• BOT_TOKEN: ${process.env.BOT_TOKEN ? '✅ Загружен' : '❌ Не найден'}\n`;
        statusMessage += `• CHAT_ID: ${process.env.CHAT_ID ? `✅ Загружен (${process.env.CHAT_ID})` : '❌ Не найден'}\n`;
        statusMessage += `• DB_HOST: ${process.env.DB_HOST ? '✅ Загружен' : '❌ Не найден'}\n`;
        statusMessage += `• ADMIN_IDS: ${process.env.ADMIN_IDS ? `✅ Загружен (${ADMIN_IDS.length} админов)` : '❌ Не найден'}\n\n`;
        
        // 2. Проверка базы данных
        statusMessage += '🗄️ База данных:\n';
        statusMessage += `• Соединение: ${db.isConnected ? '✅ Подключена' : '❌ Недоступна'}\n`;
        statusMessage += `• Пул соединений: ${db.connection ? '✅ Создан' : '❌ Не создан'}\n`;
        
        // Пробуем получить статистику из БД
        try {
            const stats = await db.getStats();
            if (stats) {
                // Функция getStats() возвращает объект с полями totalMembers, totalCars и т.д.
                const totalMembers = stats.totalMembers || 0;
                const totalCars = stats.totalCars || 0;
                statusMessage += `• Участники в БД: ✅ ${totalMembers}\n`;
                statusMessage += `• Автомобили в БД: ✅ ${totalCars}\n`;
            } else {
                statusMessage += `• Статистика БД: ❌ Недоступна\n`;
            }
        } catch (dbError) {
            statusMessage += `• Статистика БД: ❌ Ошибка (${dbError.message})\n`;
        }
        
        statusMessage += '\n';
        
        // 3. Проверка Telegram API
        statusMessage += '📱 Telegram API:\n';
        try {
            const me = await bot.getMe();
            statusMessage += `• Бот активен: ✅ @${me.username}\n`;
            statusMessage += `• ID бота: ${me.id}\n`;
        } catch (telegramError) {
            statusMessage += `• Telegram API: ❌ Ошибка (${telegramError.message})\n`;
        }
        
        // 4. Проверка членства в группе и конфигурации CHAT_ID
        statusMessage += `• CHAT_ID конфигурация: ${config.CHAT_ID}\n`;
        try {
            const botMember = await bot.getChatMember(config.CHAT_ID, (await bot.getMe()).id);
            statusMessage += `• Статус в группе: ${botMember.status === 'administrator' ? '✅ Администратор' : 
                                                botMember.status === 'member' ? '⚠️ Участник (рекомендуется админ)' : 
                                                '❌ ' + botMember.status}\n`;
        } catch (groupError) {
            statusMessage += `• Статус в группе: ❌ Недоступно (${groupError.message})\n`;
            
            // Детальная диагностика ошибки CHAT_ID
            if (groupError.response && groupError.response.body) {
                const errorBody = groupError.response.body;
                if (errorBody.error_code === 400 && errorBody.description === 'Bad Request: chat not found') {
                    statusMessage += `• ⚠️ КРИТИЧЕСКАЯ ОШИБКА: Группа с ID ${config.CHAT_ID} не найдена!\n`;
                    statusMessage += `• 💡 Решение: Проверьте CHAT_ID в .env файле и убедитесь что бот добавлен в группу\n`;
                }
            }
        }
        
        statusMessage += '\n';
        
        // 5. Системная информация
        statusMessage += '💻 Система:\n';
        statusMessage += `• Время работы: ${Math.floor(process.uptime())} сек\n`;
        statusMessage += `• Использование памяти: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB\n`;
        statusMessage += `• Node.js версия: ${process.version}\n`;
        statusMessage += `• Платформа: ${process.platform}\n\n`;
        
        // 6. Директории загрузки
        statusMessage += '📁 Файлы:\n';
        const fs = require('fs');
        const membersDir = config.UPLOADS.membersPath;
        const carsDir = config.UPLOADS.carsPath;
        
        statusMessage += `• Папка участников: ${fs.existsSync(membersDir) ? '✅ Существует' : '❌ Не найдена'}\n`;
        statusMessage += `• Папка автомобилей: ${fs.existsSync(carsDir) ? '✅ Существует' : '❌ Не найдена'}\n`;
        statusMessage += `• Путь участников: ${membersDir}\n`;
        statusMessage += `• Путь автомобилей: ${carsDir}\n`;
        
        if (fs.existsSync(membersDir)) {
            const memberFiles = fs.readdirSync(membersDir).length;
            statusMessage += `• Фото участников: ${memberFiles} файлов\n`;
        }
        
        if (fs.existsSync(carsDir)) {
            const carFiles = fs.readdirSync(carsDir).length;
            statusMessage += `• Фото автомобилей: ${carFiles} файлов\n`;
        }
        
        statusMessage += '\n';
        
        // 7. Активные пользователи
        statusMessage += '👥 Активность:\n';
        statusMessage += `• Активных состояний: ${userStates.size}\n`;
        statusMessage += `• Запрос от админа: ✅ ${msg.from.first_name} (ID: ${userId})\n`;
        
        statusMessage += `\n📅 Время проверки: ${new Date().toLocaleString('ru-RU')}`;
        
        const statusKeyboard = addBackToMenuButton({});
        bot.sendMessage(msg.chat.id, statusMessage, { 
            parse_mode: 'Markdown',
            ...statusKeyboard 
        });
        
    } catch (error) {
        console.error('❌ Ошибка в команде /status:', error);
        bot.sendMessage(msg.chat.id, `❌ Ошибка получения статуса системы: ${error.message}`);
    }
});

// Команда /setpass - установка временного пароля для получения активного статуса
bot.onText(/\/setpass/, async (msg) => {
    const userId = msg.from.id;
    
    // Проверяем админские права
    if (!isAdmin(userId)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещён! Команда доступна только администраторам.');
        return;
    }
    
    // Устанавливаем состояние для ввода пароля
    userStates.set(userId, { 
        state: 'setting_password', 
        step: 'enter_password',
        data: {}
    });
    
    const currentStatus = isPasswordActive() ? 
        `\n🔐 Текущий пароль активен (≈${getPasswordTimeLeft()} мин. осталось)` : 
        '\n⚪ Пароль не установлен';
    
    bot.sendMessage(msg.chat.id, 
        '🔐 Установка временного пароля\n\n' +
        '📋 Этот пароль позволит участникам получить статус "активный" самостоятельно.\n\n' +
        '⚡ Требования к паролю:\n' +
        '• Минимум 5 символов\n' +
        '• Время жизни: 10 минут\n' +
        '• Доступен только участникам со статусом "участник" или "без авто"\n\n' +
        currentStatus + '\n\n' +
        '✏️ Введите новый пароль:',
        { parse_mode: 'Markdown' }
    );
});

// Команда для тестирования админских прав
bot.onText(/\/admintest/, async (msg) => {
    // Для админской команды не требуется проверка группы
    
    const userId = msg.from.id;
    
    if (!isAdmin(userId)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещён! Команда доступна только администраторам.');
        return;
    }
    
    const adminTestKeyboard = addBackToMenuButton({});
    bot.sendMessage(msg.chat.id, 
        `✅ Админские права подтверждены!\n\n` +
        `👤 Ваш ID: ${userId}\n` +
        `🔧 Список админов: ${ADMIN_IDS.join(', ')}\n` +
        `📊 Статус: Администратор`,
        { 
            parse_mode: 'Markdown',
            ...adminTestKeyboard 
        }
    );
});

// Команда для просмотра логов авторизации (только для админов)
bot.onText(/\/authlogs/, async (msg) => {
    const userId = msg.from.id;
    
    if (!isAdmin(userId)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещён! Команда доступна только администраторам.');
        return;
    }
    
    try {
        const authStats = await db.getAuthStats();
        
        let logText = `📊 Статистика авторизации на сайте\n\n`;
        logText += `📈 Всего попыток: ${authStats.totalAttempts}\n`;
        logText += `✅ Успешных: ${authStats.successfulAttempts}\n`;
        logText += `❌ Неудачных: ${authStats.failedAttempts}\n`;
        logText += `👥 От участников: ${authStats.memberAttempts}\n`;
        logText += `👤 От не-участников: ${authStats.nonMemberAttempts}\n`;
        logText += `🔢 Уникальных пользователей: ${authStats.uniqueUsers}\n\n`;
        
        // Получаем последние 10 логов
        const recentLogs = await db.getAuthLogs(10);
        
        if (recentLogs.length > 0) {
            logText += `📝 Последние попытки:\n\n`;
            
            recentLogs.forEach((log, index) => {
                const date = new Date(log.auth_date).toLocaleString('ru-RU');
                const statusIcon = log.status === 'success' ? '✅' : '❌';
                const memberIcon = log.is_member ? '👥' : '👤';
                
                logText += `${index + 1}. ${statusIcon} ${memberIcon} `;
                logText += `${log.first_name || 'N/A'}`;
                if (log.username) logText += ` (@${log.username})`;
                logText += `\n   📅 ${date}`;
                if (log.notes) logText += `\n   📝 ${log.notes}`;
                logText += `\n\n`;
            });
        } else {
            logText += `📝 Логов авторизации пока нет.\n\n`;
        }
        
        logText += `🌐 Подробная информация: https://c.cabrioride.by/backend/log_auth.php`;
        
        const authLogsKeyboard = addBackToMenuButton({});
        bot.sendMessage(msg.chat.id, logText, { 
            parse_mode: 'Markdown',
            ...authLogsKeyboard 
        });
        
    } catch (error) {
        console.error('Ошибка получения логов авторизации:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка получения логов авторизации.');
    }
});

// Команда /messages удалена - подсчет сообщений отключен

// Команда для изменения статуса пользователя (только для админов)
bot.onText(/\/setuserstatus/, async (msg) => {
    const userId = msg.from.id;
    
    if (!isAdmin(userId)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещён! Команда доступна только администраторам.');
        return;
    }
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    try {
        // Начинаем процесс изменения статуса
        userStates.set(userId, { 
            state: 'setting_user_status', 
            step: 'select_status',
            data: {}
        });
        
        const statusKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🆕 Новый', callback_data: 'status_новый' },
                        { text: '⚪ Без авто', callback_data: 'status_без авто' }
                    ],
                    [
                        { text: '⚪ Участник', callback_data: 'status_участник' },
                        { text: '✅ Активный', callback_data: 'status_активный' }
                    ],
                    [
                        { text: '🚫 Вышел', callback_data: 'status_вышел' },
                        { text: '🚫 БАН', callback_data: 'status_бан' }
                    ],
                    [
                        { text: '❌ Отменить', callback_data: 'cancel_status_change' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            '🔧 Изменение статуса пользователя\n\n' +
            '📋 Шаг 1 из 2: Выберите новый статус:\n\n' +
            '🆕 **Новый** - новый участник клуба (не зарегистрирован)\n' +
            '⚪ **Без авто** - зарегистрирован, но без автомобиля\n' +
            '⚪ **Участник** - есть авто, но не был на встречах\n' +
            '✅ **Активный** - участвует во встречах клуба\n' +
            '🚫 **Вышел** - покинул клуб\n' +
            '🚫 **БАН** - заблокирован в клубе\n\n' +
            '👇 Выберите статус:', 
            { 
                parse_mode: 'Markdown',
                ...statusKeyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка команды /setuserstatus:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка выполнения команды.');
    }
});

// Команда для получения информации о чате (диагностика CHAT_ID)
bot.onText(/\/getchatid/, async (msg) => {
    const userId = msg.from.id;
    
    // Только для админов
    if (!isAdmin(userId)) {
        bot.sendMessage(msg.chat.id, '❌ Доступ запрещён! Команда доступна только администраторам.');
        return;
    }
    
    let infoMessage = '🔍 Диагностика Chat ID\n\n';
    
    // Информация о текущем чате
    infoMessage += `💬 Текущий чат:\n`;
    infoMessage += `• ID: \`${msg.chat.id}\`\n`;
    infoMessage += `• Тип: ${msg.chat.type}\n`;
    if (msg.chat.title) infoMessage += `• Название: ${msg.chat.title}\n`;
    if (msg.chat.username) infoMessage += `• Username: @${msg.chat.username}\n`;
    
    infoMessage += `\n⚙️ Конфигурация:\n`;
    infoMessage += `• Настроенный CHAT_ID: \`${config.CHAT_ID}\`\n`;
    infoMessage += `• Соответствие: ${msg.chat.id.toString() === config.CHAT_ID.toString() ? '✅ Да' : '❌ Нет'}\n`;
    
    // Если это группа/супергруппа
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        infoMessage += `\n🔧 Инструкции:\n`;
        infoMessage += `1. Скопируйте ID текущего чата: \`${msg.chat.id}\`\n`;
        infoMessage += `2. Обновите CHAT_ID в .env файле\n`;
        infoMessage += `3. Перезапустите бота\n`;
        infoMessage += `4. Убедитесь что бот является администратором группы\n`;
    } else {
        infoMessage += `\n⚠️ Внимание:\n`;
        infoMessage += `Это приватный чат. Для работы бота нужна группа или супергруппа.\n`;
    }
    
    // Пробуем получить информацию о настроенной группе
    if (config.CHAT_ID && config.CHAT_ID !== msg.chat.id.toString()) {
        infoMessage += `\n🎯 Настроенная группа:\n`;
        try {
            const chatInfo = await bot.getChat(config.CHAT_ID);
            infoMessage += `• Название: ${chatInfo.title || 'Не указано'}\n`;
            infoMessage += `• Тип: ${chatInfo.type}\n`;
            if (chatInfo.username) infoMessage += `• Username: @${chatInfo.username}\n`;
            infoMessage += `• Статус: ✅ Доступна\n`;
            
            // Проверяем статус бота в настроенной группе
            try {
                const botMember = await bot.getChatMember(config.CHAT_ID, (await bot.getMe()).id);
                infoMessage += `• Статус бота: ${botMember.status}\n`;
            } catch (memberError) {
                infoMessage += `• Статус бота: ❌ ${memberError.message}\n`;
            }
        } catch (chatError) {
            infoMessage += `• Статус: ❌ ${chatError.message}\n`;
            if (chatError.response && chatError.response.body && 
                chatError.response.body.description === 'Bad Request: chat not found') {
                infoMessage += `• ❌ Проблема: Группа с ID ${config.CHAT_ID} не существует!\n`;
            }
        }
    }
    
    bot.sendMessage(msg.chat.id, infoMessage, { parse_mode: 'Markdown' });
});

// Команда /menu
bot.onText(/\/menu/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    const userId = msg.from.id;
    const isUserAdmin = isAdmin(userId);
    
    let keyboard = {
        reply_markup: {
            inline_keyboard: [
                // Основные категории (по одной кнопке в строку)
                [
                    { text: '👤 Личный кабинет', callback_data: 'category_profile' }
                ],
                [
                    { text: '🎯 Активности клуба', callback_data: 'category_activities' }
                ],
                [
                    { text: '📊 Информация', callback_data: 'category_info' }
                ]
            ]
        }
    };
    
    // Добавляем админскую категорию если пользователь админ
    if (isUserAdmin) {
        keyboard.reply_markup.inline_keyboard.push([
            { text: '🔒 Администрирование', callback_data: 'category_admin' }
        ]);
    }
    
    let menuText = '🚗 Главное меню Cabrio Club\n\n' +
        '👤 **Личный кабинет** - профиль, автомобили\n' +
        '🎯 **Активности клуба** - приглашения, поиск\n' +
        '📊 **Информация** - статистика, сайт, помощь\n';
    
    if (isUserAdmin) {
        menuText += '🔒 **Администрирование** - управление ботом\n';
    }
    
    menuText += '\n👇 Выберите категорию:';
    
    bot.sendMessage(msg.chat.id, menuText, { parse_mode: 'Markdown', ...keyboard });
});

// Команда /register
bot.onText(/\/register/, async (msg) => {
    const groupAccess = await checkGroupAccess(msg);
    if (!groupAccess) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    const userId = msg.from.id;
    
    try {
        const existingMember = await db.getMemberByTelegramId(userId);
        
        if (existingMember) {
            if (existingMember.status === 'новый') {
                // Пользователь со статусом "новый" может пройти регистрацию
                // Сохраняем информацию о доступе к группе для дальнейшего использования
                const canSendToGroup = groupAccess === true;
                
                // Начинаем процесс регистрации
                userStates.set(userId, { 
                    state: 'registration', 
                    step: 'name',
                    groupAccess: canSendToGroup 
                });
                
                bot.sendMessage(msg.chat.id, 
                    '📝 Регистрация в Cabrio Club\n\n' +
                    'Заполните анкету для полноценного участия в клубе.\n\n' +
                    '👤 Как вас зовут? (введите ваше имя)',
                    { parse_mode: 'Markdown' }
                );
            } else {
                // Пользователь уже прошел регистрацию
                bot.sendMessage(msg.chat.id, 
                    '✅ Вы уже зарегистрированы в системе!\n\n' +
                    `📊 Ваш статус: ${existingMember.status}\n` +
                    `📅 Дата регистрации: ${formatDate(existingMember.join_date)}\n\n` +
                    'Используйте /menu для доступа к функциям бота.'
                );
            }
            return;
        }
        
        // Резервный случай - если пользователя нет в базе (не должно происходить)
        bot.sendMessage(msg.chat.id, 
            '❌ Ошибка: Ваша запись не найдена в системе.\n\n' +
            'Попробуйте выполнить команду /start сначала.'
        );
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка регистрации. Попробуйте позже.');
    }
});

// Команда /skip
bot.onText(/\/skip/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, '❌ Нет активного процесса для пропуска.');
        return;
    }
    
    // Обрабатываем как обычное сообщение с текстом "/skip"
    if (userState.state === 'registration') {
        await handleRegistration(msg, userId, userState);
    } else if (userState.state === 'adding_car') {
        bot.sendMessage(msg.chat.id, '❌ В процессе добавления автомобиля нельзя пропускать поля.');
    } else {
        bot.sendMessage(msg.chat.id, '❌ Команда /skip недоступна в текущем контексте.');
    }
});

// Команда /help
bot.onText(/\/help/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    showHelp(msg);
});

// Команда /cancel - отмена текущей операции
bot.onText(/\/cancel/, async (msg) => {
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, '❌ Нет активных операций для отмены.');
        return;
    }
    
    // Определяем тип операции для корректного сообщения
    let operationName = '';
    switch (userState.state) {
        case 'registration':
            operationName = 'регистрация';
            break;
        case 'adding_car':
            operationName = 'добавление автомобиля';
            break;
        case 'creating_invitation':
            operationName = 'создание приглашения';
            break;
        case 'searching':
            operationName = 'поиск';
            break;
        case 'setting_user_status':
            operationName = 'изменение статуса пользователя';
            break;
        default:
            operationName = 'операция';
    }
    
    userStates.delete(userId);
    
    const cancelKeyboard = addBackToMenuButton({});
    bot.sendMessage(msg.chat.id, 
        `❌ ${operationName.charAt(0).toUpperCase() + operationName.slice(1)} отменена\n\n` +
        'Вы можете начать новую операцию через главное меню.',
        { 
            parse_mode: 'Markdown',
            ...cancelKeyboard 
        }
    );
});

// Команда /done
bot.onText(/\/done/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, '❌ Нет активного процесса для завершения.');
        return;
    }
    
    // Обрабатываем как обычное сообщение с текстом "/done"
    if (userState.state === 'adding_car' && userState.step === 'photos') {
        await completeAddCar(msg, userId, userState.data);
    } else if (userState.state === 'creating_invitation' && userState.step === 'photos') {
        await completeCreateInvitation(msg, userId, userState.data);
    } else {
        bot.sendMessage(msg.chat.id, '❌ Команда /done недоступна в текущем контексте.');
    }
});

// Команда /search - поиск автомобилей по номеру
bot.onText(/\/search/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await startSearchByNumber(msg, msg.from.id);
});

// Команда /invite - создать приглашение (требует отправки в группу)
bot.onText(/\/invite/, async (msg) => {
    const groupAccess = await checkGroupAccess(msg);
    if (!groupAccess) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await startCreateInvitation(msg, msg.from.id);
});

// Команда /myinvites - мои приглашения
bot.onText(/\/myinvites/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await showUserInvitations(msg, msg.from.id);
});

// Команда /addcar - добавить автомобиль (требует отправки в группу)
bot.onText(/\/addcar/, async (msg) => {
    const groupAccess = await checkGroupAccess(msg);
    if (!groupAccess) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await startAddCar(msg, msg.from.id);
});

// Команда /profile - мой профиль
bot.onText(/\/profile/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await showUserProfile(msg, msg.from.id);
});

// Команда /cars - мои автомобили
bot.onText(/\/cars/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await showUserCars(msg, msg.from.id);
});

// Команда /stats - статистика клуба
bot.onText(/\/stats/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    await showStats(msg);
});

// Команда для просмотра статистики активности чата
bot.onText(/\/chatstats/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    // Проверяем доступность БД
    if (!await checkDatabaseAccess(msg.chat.id)) return;
    
    const userId = msg.from.id;
    
    try {
        // Получаем общую статистику чата
        const chatStats = await db.getChatStatistics();
        
        // Получаем топ активных пользователей
        const topUsers = await db.getTopActiveUsers(10);
        
        let statsMessage = '📊 Статистика активности чата\n\n';
        
        // Общая статистика
        statsMessage += '📈 Общие показатели:\n';
        statsMessage += `• Активных участников: ${chatStats.total_users || 0}\n`;
        statsMessage += `• Всего сообщений: ${chatStats.total_messages || 0}\n`;
        statsMessage += `• Отправлено фото: ${chatStats.total_photos || 0}\n`;
        statsMessage += `• Отправлено видео: ${chatStats.total_videos || 0}\n`;
        statsMessage += `• Голосовых сообщений: ${chatStats.total_voice || 0}\n`;
        statsMessage += `• Документов: ${chatStats.total_documents || 0}\n`;
        
        if (chatStats.avg_messages_per_week) {
            statsMessage += `• Среднее сообщений в неделю: ${Math.round(chatStats.avg_messages_per_week * 100) / 100}\n`;
        }
        
        if (chatStats.chat_first_message) {
            const firstDate = new Date(chatStats.chat_first_message);
            statsMessage += `• Первое сообщение: ${firstDate.toLocaleDateString('ru-RU')}\n`;
        }
        
        if (chatStats.chat_last_message) {
            const lastDate = new Date(chatStats.chat_last_message);
            statsMessage += `• Последнее сообщение: ${lastDate.toLocaleDateString('ru-RU')}\n`;
        }
        
        // Топ активных пользователей
        if (topUsers.length > 0) {
            statsMessage += '\n🏆 Топ активных участников:\n';
            
            topUsers.forEach((user, index) => {
                const username = user.username ? `@${user.username}` : '';
                const name = user.first_name;
                const displayName = username || name || `ID${user.telegram_id}`;
                
                let userLine = `${index + 1}. ${displayName}: ${user.total_messages} сообщений`;
                
                // Добавляем медиа-статистику если есть
                const mediaCount = (user.total_photos || 0) + (user.total_videos || 0) + 
                                 (user.total_voice || 0) + (user.total_documents || 0);
                if (mediaCount > 0) {
                    userLine += ` (📎${mediaCount})`;
                }
                
                // Добавляем среднее в неделю
                if (user.avg_messages_per_week > 0) {
                    userLine += ` | ${Math.round(user.avg_messages_per_week * 10) / 10}/нед`;
                }
                
                statsMessage += userLine + '\n';
            });
        }
        
        statsMessage += '\n📝 Примечание: Статистика собирается с момента добавления бота в группу.';
        
        // Кнопки для детальной статистики
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '👤 Моя статистика', callback_data: 'my_stats' },
                    { text: '🔄 Обновить', callback_data: 'refresh_stats' }
                ],
                [
                    { text: '📊 Детальная статистика', callback_data: 'detailed_stats' }
                ]
            ]
        };
        
        bot.sendMessage(msg.chat.id, statsMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики чата:', error);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка при получении статистики чата.');
    }
});

// Обработчик всех сообщений для подсчета активности пользователей
// Middleware для подсчета сообщений удален - статус "активный" назначается только админами

// Обработка callback запросов
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;
    
    // Исключения для админских команд
    if (data === 'admin_status') {
        if (!isAdmin(userId)) {
            bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
            return;
        }
    } else if (data === 'admin_test') {
        if (!isAdmin(userId)) {
            bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
            return;
        }
    } else {
        // Для остальных команд проверяем членство пользователя в группе
        if (!await checkUserMembership(userId)) {
            bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
            return;
        }
    }
    
    try {
        switch (data) {
            case 'my_profile':
                await showUserProfile(msg, userId);
                break;
                
            case 'my_cars':
                await showUserCars(msg, userId);
                break;
                
            case 'add_car':
                await startAddCar(msg, userId);
                break;
                
            case 'my_invitations':
                await showUserInvitations(msg, userId);
                break;
                
            case 'create_invitation':
                await startCreateInvitation(msg, userId);
                break;
                
            case 'stats':
                await showStats(msg);
                break;
                
            case 'web_dashboard':
                // Проверяем статус пользователя для доступа к веб-дашборду
                try {
                    const member = await db.getMemberByTelegramId(userId);
                    
                    if (!member) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Вы не зарегистрированы в клубе');
                        
                        const notRegisteredKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, 
                            '❌ Доступ к веб-дашборду ограничен\n\n' +
                            '🔐 Веб-дашборд доступен только активным участникам клуба.\n\n' +
                            'Для получения доступа необходимо:\n' +
                            '1️⃣ Зарегистрироваться в клубе\n' +
                            '2️⃣ Добавить автомобиль\n' +
                            '3️⃣ Получить статус "активный" от администратора\n\n' +
                            '👇 Начните с регистрации:',
                            { 
                                parse_mode: 'Markdown',
                                ...notRegisteredKeyboard 
                            }
                        );
                        return;
                    }
                    
                    // Проверяем статус пользователя - доступ только для активных участников
                    if (member.status !== 'активный') {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ ограничен');
                        
                        const statusIcon = member.status === 'новый' ? '🆕' : 
                                         member.status === 'без авто' ? '⚪' : 
                                         member.status === 'участник' ? '⚪' : 
                                         member.status === 'вышел' ? '🚫' : 
                                         member.status === 'бан' ? '🚫' : '❓';
                        
                        const restrictedKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📊 Обычная статистика', callback_data: 'stats' }],
                                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, 
                            '🔐 Доступ к веб-дашборду ограничен\n\n' +
                            `👤 Ваш статус: ${statusIcon} **${member.status}**\n\n` +
                            '🎯 Веб-дашборд доступен только **активным участникам** клуба.\n\n' +
                            '🚗 Статус "активный" получают участники, которые:\n' +
                            '• Приезжают на встречи клуба\n' +
                            '• Активно участвуют в жизни сообщества\n' +
                            '• Подтверждают свой статус у администратора\n\n' +
                            '📊 Пока что вы можете использовать обычную статистику.\n' +
                            '💬 Следите за объявлениями о встречах в группе!',
                            { 
                                parse_mode: 'Markdown',
                                ...restrictedKeyboard 
                            }
                        );
                        return;
                    }
                    
                    // Если пользователь активный - предоставляем доступ к веб-дашборду
                    await handleWebDashboard(msg, userId);
                    
                } catch (error) {
                    console.error('Ошибка проверки доступа к веб-дашборду:', error);
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка проверки доступа');
                    
                    const errorKeyboard = addBackToMenuButton({});
                    bot.sendMessage(msg.chat.id, 
                        '❌ Произошла ошибка при проверке доступа к веб-дашборду.\n\n' +
                        'Попробуйте позже или обратитесь к администратору.',
                        { 
                            parse_mode: 'Markdown',
                            ...errorKeyboard 
                        }
                    );
                }
                break;
                
            case 'help':
                await showHelp(msg);
                break;
                
            case 'search_by_number':
                await startSearchByNumber(msg, userId);
                break;
                
            case 'register':
                // Начинаем процесс регистрации
                const newUserState = { 
                    state: 'registration', 
                    step: 'name',
                    data: {}
                };
                userStates.set(userId, newUserState);
                
                console.log(`🔧 Установлено состояние для пользователя ${userId}:`, newUserState);
                console.log(`🔍 Проверка сохранения:`, userStates.get(userId));
                
                bot.sendMessage(msg.chat.id, 
                    '📝 Регистрация в клубе кабриолетов\n\n' +
                    '🚗 Добро пожаловать! Давайте зарегистрируем вас в нашем клубе.\n\n' +
                    '📋 **Что мы спросим:**\n' +
                    '• Имя (обязательно)\n' +
                    '• Фамилию\n' +
                    '• Дату рождения\n' +
                    '• Город и страну\n' +
                    '• Номер телефона\n' +
                    '• Рассказ о себе\n' +
                    '• Фото профиля\n\n' +
                    '✨ Обязательно только имя, остальное по желанию!\n\n' +
                    '👤 Шаг 1 из 8: Введите ваше имя:', 
                    { parse_mode: 'Markdown' }
                );
                break;
                
            case 'skip_step':
                // Обрабатываем пропуск шага
                const userStateForSkip = userStates.get(userId);
                if (userStateForSkip) {
                    if (userStateForSkip.state === 'registration') {
                        await handleRegistrationSkip(msg, userId, userStateForSkip);
                    } else if (userStateForSkip.state === 'adding_car') {
                        if (userStateForSkip.step === 'reg_number') {
                            // Пропускаем регистрационный номер
                            userStateForSkip.step = 'photos';
                            userStates.set(userId, userStateForSkip);
                            
                            const carPhotosKeyboard = {
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            { text: '✅ Закончить', callback_data: 'finish_photos' },
                                            { text: '⏭️ Пропустить фото', callback_data: 'skip_step' }
                                        ]
                                    ]
                                }
                            };
                            
                            bot.sendMessage(msg.chat.id, 
                                '📸 Шаг 5/5: Загрузите фотографии вашего автомобиля!\n' +
                                'Вы можете отправить несколько фото подряд.', 
                                { 
                                    parse_mode: 'Markdown',
                                    ...carPhotosKeyboard 
                                }
                            );
                        } else if (userStateForSkip.step === 'photos') {
                            // Пропускаем фото и завершаем добавление автомобиля
                            await completeAddCar(msg, userId, userStateForSkip.data);
                        } else {
                            bot.sendMessage(msg.chat.id, '❌ В процессе добавления автомобиля можно пропускать только регистрационный номер и фото.');
                        }
                    } else if (userStateForSkip.state === 'creating_invitation') {
                        await handleInvitationSkip(msg, userId, userStateForSkip);
                    }
                }
                break;
                
            case 'finish_photos':
                // Обрабатываем завершение добавления фото
                const userStateForFinish = userStates.get(userId);
                if (userStateForFinish) {
                    if (userStateForFinish.state === 'adding_car' && userStateForFinish.step === 'photos') {
                        await completeAddCar(msg, userId, userStateForFinish.data);
                    } else if (userStateForFinish.state === 'creating_invitation' && userStateForFinish.step === 'photos') {
                        await completeCreateInvitation(msg, userId, userStateForFinish.data);
                    }
                }
                break;
                
            case 'continue_photos':
                // Пользователь хочет добавить ещё фото - просто отправляем подсказку
                const userStateForContinue = userStates.get(userId);
                if (userStateForContinue) {
                    if (userStateForContinue.state === 'adding_car' && userStateForContinue.step === 'photos') {
                        bot.sendMessage(msg.chat.id, '📸 Отправьте следующую фотографию автомобиля');
                    } else if (userStateForContinue.state === 'creating_invitation' && userStateForContinue.step === 'photos') {
                        bot.sendMessage(msg.chat.id, '📸 Отправьте следующую фотографию автомобиля');
                    }
                }
                break;
                
            case 'finish_invitation':
                // Завершаем создание приглашения
                const userStateForFinishInvitation = userStates.get(userId);
                if (userStateForFinishInvitation && userStateForFinishInvitation.state === 'creating_invitation') {
                    await completeCreateInvitation(msg, userId, userStateForFinishInvitation.data);
                }
                break;
                
            case 'menu':
            case 'back_to_menu':
                // Показываем главное меню с категориями
                const isUserAdminCallback = isAdmin(userId);
                
                let menuKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            // Основные категории (по одной кнопке в строку)
                            [
                                { text: '👤 Личный кабинет', callback_data: 'category_profile' }
                            ],
                            [
                                { text: '🎯 Активности клуба', callback_data: 'category_activities' }
                            ],
                            [
                                { text: '📊 Информация', callback_data: 'category_info' }
                            ]
                        ]
                    }
                };
                
                // Добавляем админскую категорию если пользователь админ
                if (isUserAdminCallback) {
                    menuKeyboard.reply_markup.inline_keyboard.push([
                        { text: '🔒 Администрирование', callback_data: 'category_admin' }
                    ]);
                }
                
                let menuTextCallback = '🚗 Главное меню Cabrio Club\n\n' +
                    '👤 **Личный кабинет** - профиль, автомобили\n' +
                    '🎯 **Активности клуба** - приглашения, поиск\n' +
                    '📊 **Информация** - статистика, сайт, помощь\n';
                
                if (isUserAdminCallback) {
                    menuTextCallback += '🔒 **Администрирование** - управление ботом\n';
                }
                
                menuTextCallback += '\n👇 Выберите категорию:';
                
                try {
                    // Пытаемся отредактировать сообщение
                    await bot.editMessageText(menuTextCallback, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...menuKeyboard
                    });
                } catch (editError) {
                    // Если не удалось отредактировать, отправляем новое сообщение
                    console.log('Не удалось отредактировать сообщение, отправляем новое:', editError.message);
                    await bot.sendMessage(msg.chat.id, menuTextCallback, {
                        parse_mode: 'Markdown',
                        ...menuKeyboard
                    });
                }
                break;
                
            case 'category_profile':
                // Показываем подменю "Личный кабинет"
                const profileKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '👤 Мой профиль', callback_data: 'my_profile' },
                                { text: '🚗 Мои авто', callback_data: 'my_cars' }
                            ],
                            [
                                { text: '📝 Добавить авто', callback_data: 'add_car' }
                            ],
                            [
                                { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                            ]
                        ]
                    }
                };
                
                const profileText = '👤 Личный кабинет\n\n' +
                    '🔧 Управление вашим профилем и автомобилями:\n\n' +
                    '• **Мой профиль** - просмотр и редактирование данных\n' +
                    '• **Мои авто** - список ваших автомобилей\n' +
                    '• **Добавить авто** - регистрация нового автомобиля\n\n' +
                    '👇 Выберите действие:';
                
                try {
                    await bot.editMessageText(profileText, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...profileKeyboard
                    });
                } catch (editError) {
                    await bot.sendMessage(msg.chat.id, profileText, {
                        parse_mode: 'Markdown',
                        ...profileKeyboard
                    });
                }
                break;
                
            case 'category_activities':
                // Показываем подменю "Активности клуба"
                const activitiesKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🎉 События клуба', callback_data: 'events_menu' },
                                { text: '🔧 Сервисы', callback_data: 'services_menu' }
                            ],
                            [
                                { text: '🎯 Оставить приглашение', callback_data: 'create_invitation' },
                                { text: '🔍 Поиск авто', callback_data: 'search_by_number' }
                            ],
                            [
                                { text: '📮 Мои приглашения', callback_data: 'my_invitations' }
                            ],
                            [
                                { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                            ]
                        ]
                    }
                };
                
                const activitiesText = '🎯 Активности клуба\n\n' +
                    '🚗 Взаимодействие с другими участниками:\n\n' +
                    '• **События клуба** - заезды, встречи, фотосессии\n' +
                    '• **Сервисы** - каталог автосервисов с рейтингами\n\n' +
                    '📨 **Приглашения:**\n' +
                    '• **Оставить приглашение** - пригласить автомобиль в клуб\n' +
                    '• **Поиск авто** - найти автомобиль по номеру\n' +
                    '• **Мои приглашения** - просмотр отправленных приглашений\n\n' +
                    '👇 Выберите действие:';
                
                try {
                    await bot.editMessageText(activitiesText, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...activitiesKeyboard
                    });
                } catch (editError) {
                    await bot.sendMessage(msg.chat.id, activitiesText, {
                        parse_mode: 'Markdown',
                        ...activitiesKeyboard
                    });
                }
                break;
                
            case 'category_info':
                // Показываем подменю "Информация"
                const infoKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🏠 Сайт клуба', url: 'https://cabrioride.by' }
                            ],
                            [
                                { text: '🌐 Веб-дашборд', callback_data: 'web_dashboard' }
                            ],
                            [
                                { text: '📊 Статистика клуба', callback_data: 'stats' }
                            ],
                            [
                                { text: '❓ Помощь', callback_data: 'help' }
                            ],
                            [
                                { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                            ]
                        ]
                    }
                };
                
                const infoText = '📊 Информация\n\n' +
                    '📈 Данные и справочная информация:\n\n' +
                    '• **Сайт клуба** - официальный сайт cabrioride.by\n' +
                    '• **Веб-дашборд** - расширенная статистика в браузере\n' +
                    '• **Статистика клуба** - общие показатели участников\n' +
                    '• **Помощь** - список команд и инструкции\n\n' +
                    '👇 Выберите действие:';
                
                try {
                    await bot.editMessageText(infoText, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...infoKeyboard
                    });
                } catch (editError) {
                    await bot.sendMessage(msg.chat.id, infoText, {
                        parse_mode: 'Markdown',
                        ...infoKeyboard
                    });
                }
                break;
                
            case 'category_admin':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                // Показываем подменю "Администрирование"
                const adminKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔧 Системный статус', callback_data: 'admin_status' },
                                { text: '🔐 Тест админа', callback_data: 'admin_test' }
                            ],
                            [
                                { text: '🔕 Настройки уведомлений', callback_data: 'notification_settings' },
                                { text: '📊 Логи авторизации', callback_data: 'auth_logs' }
                            ],
                            [
                                { text: '🔧 Изменить статус', callback_data: 'start_setuserstatus' },
                                { text: '🔐 Установить пароль', callback_data: 'admin_setpass' }
                            ],
                            [
                                { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                            ]
                        ]
                    }
                };
                
                const passwordStatus = isPasswordActive() ? 
                    `\n🔐 **Пароль активен** (≈${getPasswordTimeLeft()} мин. осталось)` : 
                    '\n⚪ **Пароль не установлен**';
                
                const adminText = '🔒 Администрирование\n\n' +
                    '⚙️ Управление ботом и участниками:\n\n' +
                    '• **Системный статус** - диагностика бота\n' +
                    '• **Тест админа** - проверка прав доступа\n' +
                    '• **Настройки уведомлений** - управление уведомлениями\n' +
                    '• **Логи авторизации** - статистика входов на сайт\n' +
                    '• **Изменить статус** - управление статусами участников\n' +
                    '• **Установить пароль** - временный пароль для получения активного статуса\n' +
                    passwordStatus + '\n\n' +
                    '👇 Выберите действие:';
                
                try {
                    await bot.editMessageText(adminText, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...adminKeyboard
                    });
                } catch (editError) {
                    await bot.sendMessage(msg.chat.id, adminText, {
                        parse_mode: 'Markdown',
                        ...adminKeyboard
                    });
                }
                break;

            // =====================================================
            // 🎉 События клуба
            // =====================================================
            
            case 'events_menu':
                // Показываем меню событий
                const eventsKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📅 Все события', callback_data: 'view_all_events' },
                                { text: '➕ Создать событие', callback_data: 'create_event' }
                            ],
                            [
                                { text: '📋 Мои события', callback_data: 'my_events' }
                            ],
                            [
                                { text: '🔙 Назад к активностям', callback_data: 'category_activities' }
                            ]
                        ]
                    }
                };
                
                const eventsText = '🎉 События клуба\n\n' +
                    '📅 Управление мероприятиями клуба:\n\n' +
                    '• **Все события** - просмотр всех запланированных мероприятий\n' +
                    '• **Создать событие** - организовать новое мероприятие\n' +
                    '• **Мои события** - события, которые вы организуете\n\n' +
                    '🎯 Типы событий: заезды, встречи, фотосессии, поездки, банкеты\n\n' +
                    '👇 Выберите действие:';
                
                try {
                    await bot.editMessageText(eventsText, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...eventsKeyboard
                    });
                } catch (editError) {
                    await bot.sendMessage(msg.chat.id, eventsText, {
                        parse_mode: 'Markdown',
                        ...eventsKeyboard
                    });
                }
                break;

            case 'services_menu':
                // Показываем меню сервисов
                const servicesKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🏪 Все сервисы', callback_data: 'view_all_services' },
                                { text: '➕ Добавить сервис', callback_data: 'add_service' }
                            ],
                            [
                                { text: '⭐ Рекомендуемые', callback_data: 'recommended_services' },
                                { text: '🏙️ По городам', callback_data: 'services_by_city' }
                            ],
                            [
                                { text: '🔧 По типам', callback_data: 'services_by_type' }
                            ],
                            [
                                { text: '🔙 Назад к активностям', callback_data: 'category_activities' }
                            ]
                        ]
                    }
                };
                
                const servicesText = '🔧 Каталог сервисов\n\n' +
                    '🏪 Автосервисы с рейтингами и рекомендациями клуба:\n\n' +
                    '• **Все сервисы** - полный каталог автосервисов\n' +
                    '• **Добавить сервис** - предложить новый сервис\n' +
                    '• **Рекомендуемые** - сервисы, одобренные клубом\n' +
                    '• **По городам** - поиск сервисов в вашем городе\n' +
                    '• **По типам** - автосервис, детейлинг, шиномонтаж и др.\n\n' +
                    '⭐ Рейтинги и отзывы от участников клуба\n\n' +
                    '👇 Выберите действие:';
                
                try {
                    await bot.editMessageText(servicesText, {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...servicesKeyboard
                    });
                } catch (editError) {
                    await bot.sendMessage(msg.chat.id, servicesText, {
                        parse_mode: 'Markdown',
                        ...servicesKeyboard
                    });
                }
                break;

            case 'view_all_events':
                // Показываем все события
                await showAllEvents(msg, userId);
                break;

            case 'view_all_services':
                // Показываем все сервисы
                await showAllServices(msg, userId);
                break;

            case 'create_event':
                // Заглушка - функция в разработке
                bot.answerCallbackQuery(callbackQuery.id, '🚧 Функция в разработке');
                bot.sendMessage(msg.chat.id, 
                    '🚧 **Создание событий - в разработке**\n\n' +
                    '⚡ Функция находится в стадии разработки.\n' +
                    '📅 Скоро вы сможете создавать события клуба через бота!\n\n' +
                    '💬 Пока что обращайтесь к администраторам для организации мероприятий.',
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Назад к событиям', callback_data: 'events_menu' }]
                            ]
                        }
                    }
                );
                break;

            case 'add_service':
                // Заглушка - функция в разработке
                bot.answerCallbackQuery(callbackQuery.id, '🚧 Функция в разработке');
                bot.sendMessage(msg.chat.id, 
                    '🚧 **Добавление сервисов - в разработке**\n\n' +
                    '⚡ Функция находится в стадии разработки.\n' +
                    '🔧 Скоро вы сможете добавлять автосервисы в каталог!\n\n' +
                    '💬 Пока что сообщайте администраторам о проверенных сервисах.',
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Назад к сервисам', callback_data: 'services_menu' }]
                            ]
                        }
                    }
                );
                break;

            // Дополнительные функции в разработке
            case 'my_events':
            case 'recommended_services':
            case 'services_by_city':
            case 'services_by_type':
                bot.answerCallbackQuery(callbackQuery.id, '🚧 Функция в разработке');
                bot.sendMessage(msg.chat.id, 
                    '🚧 **Функция в разработке**\n\n' +
                    '⚡ Эта функция находится в стадии разработки.\n' +
                    '🔜 Скоро она будет доступна!\n\n' +
                    '💬 Следите за обновлениями бота.',
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                            ]
                        }
                    }
                );
                break;
                
            case 'get_active_status':
                // Обработка запроса на получение активного статуса
                try {
                    const member = await db.getMemberByTelegramId(userId);
                    
                    if (!member) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Вы не зарегистрированы в клубе');
                        
                        const notRegisteredKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, 
                            '❌ Получение активного статуса недоступно\n\n' +
                            '🔐 Для получения активного статуса необходимо быть зарегистрированным в клубе.\n\n' +
                            '👇 Сначала пройдите регистрацию:',
                            { 
                                parse_mode: 'Markdown',
                                ...notRegisteredKeyboard 
                            }
                        );
                        return;
                    }
                    
                    // Проверяем статус пользователя
                    if (member.status === 'активный') {
                        bot.answerCallbackQuery(callbackQuery.id, '✅ Вы уже активный участник');
                        
                        const alreadyActiveKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '🌐 Веб-дашборд', callback_data: 'web_dashboard' }],
                                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, 
                            '✅ Вы уже активный участник!\n\n' +
                            '🎯 Ваш статус: **активный**\n\n' +
                            '🌐 Вам доступны все функции, включая веб-дашборд.\n' +
                            '🚗 Спасибо за активное участие в жизни клуба!',
                            { 
                                parse_mode: 'Markdown',
                                ...alreadyActiveKeyboard 
                            }
                        );
                        return;
                    }
                    
                    // Проверяем, может ли пользователь получить активный статус
                    if (member.status !== 'участник' && member.status !== 'без авто') {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Статус не позволяет');
                        
                        const statusIcon = member.status === 'новый' ? '🆕' : 
                                         member.status === 'вышел' ? '🚫' : 
                                         member.status === 'бан' ? '🚫' : '❓';
                        
                        const cantUpgradeKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📊 Статистика клуба', callback_data: 'stats' }],
                                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, 
                            '❌ Получение активного статуса недоступно\n\n' +
                            `👤 Ваш статус: ${statusIcon} **${member.status}**\n\n` +
                            '🎯 Активный статус могут получить только участники со статусом:\n' +
                            '• ⚪ **Участник** - есть авто, но не был на встречах\n' +
                            '• ⚪ **Без авто** - зарегистрирован, но без автомобиля\n\n' +
                            '💬 Обратитесь к администратору для изменения статуса.',
                            { 
                                parse_mode: 'Markdown',
                                ...cantUpgradeKeyboard 
                            }
                        );
                        return;
                    }
                    
                    // Проверяем, активен ли пароль
                    if (!isPasswordActive()) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Пароль не установлен');
                        
                        const noPasswordKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📊 Статистика клуба', callback_data: 'stats' }],
                                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, 
                            '🔐 Получение активного статуса временно недоступно\n\n' +
                            '⏰ В данный момент администратор не установил временный пароль.\n\n' +
                            '🚗 Эта функция активируется на встречах клуба:\n' +
                            '• Администратор устанавливает пароль на 10 минут\n' +
                            '• Участники встречи могут получить активный статус\n' +
                            '• Пароль автоматически удаляется через 10 минут\n\n' +
                            '💬 Следите за объявлениями о встречах в группе!',
                            { 
                                parse_mode: 'Markdown',
                                ...noPasswordKeyboard 
                            }
                        );
                        return;
                    }
                    
                    // Если всё в порядке - запрашиваем пароль
                    userStates.set(userId, { 
                        state: 'entering_password', 
                        step: 'enter_password',
                        data: { telegramId: member.telegram_id, memberId: member.id, currentStatus: member.status }
                    });
                    
                    const statusIcon = member.status === 'участник' ? '⚪' : '⚪';
                    
                    bot.sendMessage(msg.chat.id, 
                        '🎯 Получение активного статуса\n\n' +
                        `👤 Ваш статус: ${statusIcon} **${member.status}**\n\n` +
                        '🔐 Администратор установил временный пароль для участников встречи.\n\n' +
                        '⚡ После ввода правильного пароля ваш статус изменится на **активный**.\n\n' +
                        '✏️ Введите пароль:',
                        { parse_mode: 'Markdown' }
                    );
                    
                } catch (error) {
                    console.error('Ошибка при обработке запроса активного статуса:', error);
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка обработки запроса');
                    
                    const errorKeyboard = addBackToMenuButton({});
                    bot.sendMessage(msg.chat.id, 
                        '❌ Произошла ошибка при обработке запроса.\n\n' +
                        'Попробуйте позже или обратитесь к администратору.',
                        { 
                            parse_mode: 'Markdown',
                            ...errorKeyboard 
                        }
                    );
                }
                break;
                
            case 'start_setuserstatus':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                // Начинаем процесс изменения статуса
                userStates.set(userId, { 
                    state: 'setting_user_status', 
                    step: 'select_status',
                    data: {}
                });
                
                const statusKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🆕 Новый', callback_data: 'status_новый' },
                                { text: '⚪ Без авто', callback_data: 'status_без авто' }
                            ],
                            [
                                { text: '⚪ Участник', callback_data: 'status_участник' },
                                { text: '✅ Активный', callback_data: 'status_активный' }
                            ],
                            [
                                { text: '🚫 Вышел', callback_data: 'status_вышел' },
                                { text: '🚫 БАН', callback_data: 'status_бан' }
                            ],
                            [
                                { text: '❌ Отменить', callback_data: 'cancel_status_change' }
                            ]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, 
                    '🔧 Изменение статуса пользователя\n\n' +
                    '📋 Шаг 1 из 2: Выберите новый статус:\n\n' +
                    '🆕 **Новый** - новый участник клуба (не зарегистрирован)\n' +
                    '⚪ **Без авто** - зарегистрирован, но без автомобиля\n' +
                    '⚪ **Участник** - есть авто, но не был на встречах\n' +
                    '✅ **Активный** - участвует во встречах клуба\n' +
                    '🚫 **Вышел** - покинул клуб\n' +
                    '🚫 **БАН** - заблокирован в клубе\n\n' +
                    '👇 Выберите статус:', 
                    { 
                        parse_mode: 'Markdown',
                        ...statusKeyboard 
                    }
                );
                break;
                
            case 'edit_profile':
                await showEditProfileMenu(msg, userId);
                break;
                
            case 'admin_status':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                // Выполняем ту же логику что и команда /status
                try {
                    let statusMessage = '🔧 Системная диагностика бота\n\n';
                    
                    // 1. Проверка переменных окружения
                    statusMessage += '📋 Переменные окружения:\n';
                    statusMessage += `• BOT_TOKEN: ${process.env.BOT_TOKEN ? '✅ Загружен' : '❌ Не найден'}\n`;
                    statusMessage += `• CHAT_ID: ${process.env.CHAT_ID ? `✅ Загружен (${process.env.CHAT_ID})` : '❌ Не найден'}\n`;
                    statusMessage += `• DB_HOST: ${process.env.DB_HOST ? '✅ Загружен' : '❌ Не найден'}\n`;
                    statusMessage += `• ADMIN_IDS: ${process.env.ADMIN_IDS ? `✅ Загружен (${ADMIN_IDS.length} админов)` : '❌ Не найден'}\n\n`;
                    
                    // 2. Проверка базы данных
                    statusMessage += '🗄️ База данных:\n';
                    statusMessage += `• Соединение: ${db.isConnected ? '✅ Подключена' : '❌ Недоступна'}\n`;
                    statusMessage += `• Пул соединений: ${db.connection ? '✅ Создан' : '❌ Не создан'}\n`;
                    
                    // Пробуем получить статистику из БД
                    try {
                        const stats = await db.getStats();
                        if (stats) {
                            // Функция getStats() возвращает объект с полями totalMembers, totalCars и т.д.
                            const totalMembers = stats.totalMembers || 0;
                            const totalCars = stats.totalCars || 0;
                            statusMessage += `• Участники в БД: ✅ ${totalMembers}\n`;
                            statusMessage += `• Автомобили в БД: ✅ ${totalCars}\n`;
                        } else {
                            statusMessage += `• Статистика БД: ❌ Недоступна\n`;
                        }
                    } catch (dbError) {
                        statusMessage += `• Статистика БД: ❌ Ошибка (${dbError.message})\n`;
                    }
                    
                    statusMessage += '\n';
                    
                    // 3. Проверка Telegram API
                    statusMessage += '📡 Telegram Bot API:\n';
                    try {
                        const me = await bot.getMe();
                        statusMessage += `• Бот активен: ✅ @${me.username}\n`;
                        statusMessage += `• ID бота: ${me.id}\n`;
                    } catch (telegramError) {
                        statusMessage += `• Telegram API: ❌ Ошибка (${telegramError.message})\n`;
                    }
                    
                    // 4. Проверка членства в группе
                    try {
                        const botMember = await bot.getChatMember(config.CHAT_ID, (await bot.getMe()).id);
                        statusMessage += `• Статус в группе: ${botMember.status === 'administrator' ? '✅ Администратор' : 
                                                            botMember.status === 'member' ? '⚠️ Участник (рекомендуется админ)' : 
                                                            '❌ ' + botMember.status}\n`;
                    } catch (groupError) {
                        statusMessage += `• Статус в группе: ❌ Недоступно (${groupError.message})\n`;
                    }
                    
                    statusMessage += '\n';
                    
                    // 5. Системная информация
                    statusMessage += '💻 Система:\n';
                    statusMessage += `• Время работы: ${Math.floor(process.uptime())} сек\n`;
                    statusMessage += `• Использование памяти: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB\n`;
                    statusMessage += `• Node.js версия: ${process.version}\n`;
                    statusMessage += `• Платформа: ${process.platform}\n\n`;
                    
                            // 6. Директории загрузки
        statusMessage += '📁 Файлы:\n';
        const fs = require('fs');
        const membersDir = config.UPLOADS.membersPath;
        const carsDir = config.UPLOADS.carsPath;
        
        statusMessage += `• Папка участников: ${fs.existsSync(membersDir) ? '✅ Существует' : '❌ Не найдена'}\n`;
        statusMessage += `• Папка автомобилей: ${fs.existsSync(carsDir) ? '✅ Существует' : '❌ Не найдена'}\n`;
        statusMessage += `• Путь участников: ${membersDir}\n`;
        statusMessage += `• Путь автомобилей: ${carsDir}\n`;
                    
                    if (fs.existsSync(membersDir)) {
                        const memberFiles = fs.readdirSync(membersDir).length;
                        statusMessage += `• Фото участников: ${memberFiles} файлов\n`;
                    }
                    
                    if (fs.existsSync(carsDir)) {
                        const carFiles = fs.readdirSync(carsDir).length;
                        statusMessage += `• Фото автомобилей: ${carFiles} файлов\n`;
                    }
                    
                    statusMessage += '\n';
                    
                    // 7. Активные пользователи
                    statusMessage += '👥 Активность:\n';
                    statusMessage += `• Активных состояний: ${userStates.size}\n`;
                    statusMessage += `• Запрос от админа: ✅ ${callbackQuery.from.first_name} (ID: ${userId})\n`;
                    
                    statusMessage += `\n📅 Время проверки: ${new Date().toLocaleString('ru-RU')}`;
                    
                    const callbackStatusKeyboard = addBackToMenuButton({});
                    bot.sendMessage(msg.chat.id, statusMessage, { 
                        parse_mode: 'Markdown',
                        ...callbackStatusKeyboard 
                    });
                    
                } catch (error) {
                    console.error('❌ Ошибка в callback admin_status:', error);
                    bot.sendMessage(msg.chat.id, `❌ Ошибка получения статуса системы: ${error.message}`);
                }
                break;
                
            case 'admin_test':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                const callbackAdminTestKeyboard = addBackToMenuButton({});
                bot.sendMessage(msg.chat.id, 
                    `✅ Админские права подтверждены!\n\n` +
                    `👤 Ваш ID: ${userId}\n` +
                    `🔧 Список админов: ${ADMIN_IDS.join(', ')}\n` +
                    `📊 Статус: Администратор\n` +
                    `🎛️ Доступ: Полный доступ к функциям бота`,
                    { 
                        parse_mode: 'Markdown',
                        ...callbackAdminTestKeyboard 
                    }
                );
                break;
                
            case 'notification_settings':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                const notificationStatus = optionsManager.getNotificationStatus();
                const notificationKeyboard = addBackToMenuButton({});
                
                bot.sendMessage(msg.chat.id, 
                    `🔕 Настройки уведомлений\n\n` +
                    `${notificationStatus}\n\n` +
                    `💡 Как изменить настройки:\n` +
                    `1️⃣ Откройте файл options.json в корне проекта\n` +
                    `2️⃣ Измените значения enabled: 1 (включено) или 0 (выключено)\n` +
                    `3️⃣ Сохраните файл - настройки применятся автоматически\n\n` +
                    `📝 Пример:\n` +
                    `"new_invitation": {"enabled": 0} - отключить приглашения\n` +
                    `"new_member": {"enabled": 1} - включить новых участников`,
                    { 
                        parse_mode: 'Markdown',
                        ...notificationKeyboard 
                    }
                );
                break;

            case 'auth_logs':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                try {
                    const authStats = await db.getAuthStats();
                    
                    let logText = `📊 Статистика авторизации на сайте\n\n`;
                    logText += `📈 Всего попыток: ${authStats.totalAttempts}\n`;
                    logText += `✅ Успешных: ${authStats.successfulAttempts}\n`;
                    logText += `❌ Неудачных: ${authStats.failedAttempts}\n`;
                    logText += `👥 От участников: ${authStats.memberAttempts}\n`;
                    logText += `👤 От не-участников: ${authStats.nonMemberAttempts}\n`;
                    logText += `🔢 Уникальных пользователей: ${authStats.uniqueUsers}\n\n`;
                    
                    // Получаем последние 10 логов
                    const recentLogs = await db.getAuthLogs(10);
                    
                    if (recentLogs.length > 0) {
                        logText += `📝 Последние попытки:\n\n`;
                        
                        recentLogs.forEach((log, index) => {
                            const date = new Date(log.auth_date).toLocaleString('ru-RU');
                            const statusIcon = log.status === 'success' ? '✅' : '❌';
                            const memberIcon = log.is_member ? '👥' : '👤';
                            
                            logText += `${index + 1}. ${statusIcon} ${memberIcon} `;
                            logText += `${log.first_name || 'N/A'}`;
                            if (log.username) logText += ` (@${log.username})`;
                            logText += `\n   📅 ${date}`;
                            if (log.notes) logText += `\n   📝 ${log.notes}`;
                            logText += `\n\n`;
                        });
                    } else {
                        logText += `📝 Логов авторизации пока нет.\n\n`;
                    }
                    
                    logText += `🌐 Подробная информация: https://c.cabrioride.by/backend/log_auth.php`;
                    
                    const authLogsKeyboard = addBackToMenuButton({});
                    bot.sendMessage(msg.chat.id, logText, { 
                        parse_mode: 'Markdown',
                        ...authLogsKeyboard 
                    });
                    
                } catch (error) {
                    console.error('Ошибка получения логов авторизации:', error);
                    bot.sendMessage(msg.chat.id, '❌ Ошибка получения логов авторизации.');
                }
                break;
                
            case 'admin_setpass':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                // Устанавливаем состояние для ввода пароля
                userStates.set(userId, { 
                    state: 'setting_password', 
                    step: 'enter_password',
                    data: {}
                });
                
                const currentStatus = isPasswordActive() ? 
                    `\n🔐 Текущий пароль активен (≈${getPasswordTimeLeft()} мин. осталось)` : 
                    '\n⚪ Пароль не установлен';
                
                bot.sendMessage(msg.chat.id, 
                    '🔐 Установка временного пароля\n\n' +
                    '📋 Этот пароль позволит участникам получить статус "активный" самостоятельно.\n\n' +
                    '⚡ Требования к паролю:\n' +
                    '• Минимум 5 символов\n' +
                    '• Время жизни: 10 минут\n' +
                    '• Доступен только участникам со статусом "участник" или "без авто"\n\n' +
                    currentStatus + '\n\n' +
                    '✏️ Введите новый пароль или используйте /cancel для отмены:',
                    { parse_mode: 'Markdown' }
                );
                break;
                
            case 'continue_invitation':
                // Продолжаем создание приглашения
                const userStateForContinueInvitation = userStates.get(userId);
                if (userStateForContinueInvitation && 
                    userStateForContinueInvitation.state === 'creating_invitation' && 
                    userStateForContinueInvitation.step === 'confirm_duplicate') {
                    
                    userStateForContinueInvitation.step = 'photos';
                    userStates.set(userId, userStateForContinueInvitation);
                    
                    const invitationPhotosKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Закончить фото', callback_data: 'finish_photos' },
                                    { text: '⏭️ Пропустить фото', callback_data: 'skip_step' }
                                ]
                            ]
                        }
                    };
                    
                    bot.sendMessage(msg.chat.id, 
                        `🔢 Номер: ${userStateForContinueInvitation.data.reg_number} ✅\n\n` +
                        '📸 Сфотографируйте автомобиль\n' +
                        'Это поможет лучше идентифицировать автомобиль при повторной встрече.\n\n' +
                        '• Отправьте одну или несколько фотографий',
                        { 
                            parse_mode: 'Markdown',
                            ...invitationPhotosKeyboard 
                        }
                    );
                }
                break;
                
            case 'cancel_invitation':
                // Отменяем создание приглашения
                const userStateForCancelInvitation = userStates.get(userId);
                if (userStateForCancelInvitation && 
                    userStateForCancelInvitation.state === 'creating_invitation' && 
                    userStateForCancelInvitation.step === 'confirm_duplicate') {
                    
                    userStates.delete(userId);
                    
                    const cancelKeyboard = addBackToMenuButton({});
                    bot.sendMessage(msg.chat.id, 
                        '❌ Создание приглашения отменено\n\n' +
                        'Вы можете создать новое приглашение в любое время через главное меню.',
                        { 
                            parse_mode: 'Markdown',
                            ...cancelKeyboard 
                        }
                    );
                }
                break;
                
            // Обработка выбора статуса для изменения
            case 'status_новый':
            case 'status_без авто':
            case 'status_участник':
            case 'status_активный':
            case 'status_вышел':
            case 'status_бан':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                const userStateForStatus = userStates.get(userId);
                if (userStateForStatus && userStateForStatus.state === 'setting_user_status') {
                    // Извлекаем статус из callback_data
                    const selectedStatus = data.replace('status_', '');
                    
                    // Сохраняем выбранный статус
                    userStateForStatus.data.selectedStatus = selectedStatus;
                    userStateForStatus.step = 'enter_username';
                    userStates.set(userId, userStateForStatus);
                    
                    const statusIcon = selectedStatus === 'активный' ? '✅' : 
                                     selectedStatus === 'новый' ? '🆕' : 
                                     selectedStatus === 'без авто' ? '⚪' : 
                                     selectedStatus === 'участник' ? '⚪' : 
                                     selectedStatus === 'бан' ? '🚫' : '🚫';
                    
                    bot.sendMessage(msg.chat.id, 
                        `🔧 Изменение статуса пользователя\n\n` +
                        `📋 Шаг 2 из 2: Введите username пользователя\n\n` +
                        `${statusIcon} Выбранный статус: **${selectedStatus}**\n\n` +
                        `👤 Введите Telegram username пользователя (без @):\n` +
                        `Например: ivan_petrov или @ivan_petrov\n\n` +
                        `❌ Для отмены используйте /cancel`, 
                        { parse_mode: 'Markdown' }
                    );
                }
                break;
                
            case 'cancel_status_change':
                // Проверяем админские права
                if (!isAdmin(userId)) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                    return;
                }
                
                userStates.delete(userId);
                
                const cancelKeyboard = addBackToMenuButton({});
                bot.sendMessage(msg.chat.id, 
                    '❌ Изменение статуса отменено\n\n' +
                    'Вы можете повторить операцию в любое время через команду /setuserstatus',
                    { 
                        parse_mode: 'Markdown',
                        ...cancelKeyboard 
                    }
                                 );
                 break;
                 
             case 'confirm_status_change':
                 // Проверяем админские права
                 if (!isAdmin(userId)) {
                     bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
                     return;
                 }
                 
                 const userStateForConfirm = userStates.get(userId);
                 if (userStateForConfirm && userStateForConfirm.state === 'setting_user_status' && 
                     userStateForConfirm.step === 'confirm') {
                     
                     const targetMember = userStateForConfirm.data.targetMember;
                     const selectedStatus = userStateForConfirm.data.selectedStatus;
                     const adminName = msg.from?.first_name || 'Админ';
                     
                     // Выполняем изменение статуса
                     const result = await db.updateMemberStatus(targetMember.telegram_id, selectedStatus, userId);
                     
                     userStates.delete(userId);
                     
                     if (result.success) {
                         const member = result.member;
                         const statusIcon = selectedStatus === 'активный' ? '✅' : 
                                          selectedStatus === 'новый' ? '🆕' : 
                                          selectedStatus === 'без авто' ? '⚪' : 
                                          selectedStatus === 'участник' ? '⚪' : 
                                          selectedStatus === 'бан' ? '🚫' : '🚫';
                         
                         let successText = `✅ Статус пользователя изменён успешно!\n\n`;
                         successText += `👤 **Пользователь:** ${member.first_name}`;
                         if (member.last_name) successText += ` ${member.last_name}`;
                         successText += `\n📱 **Username:** @${member.nickname}`;
                         successText += `\n📊 **Старый статус:** ${member.old_status}`;
                         successText += `\n🔄 **Новый статус:** ${statusIcon} ${member.new_status}`;
                         successText += `\n👨‍💼 **Изменил:** ${adminName}`;
                         successText += `\n📅 **Время:** ${new Date().toLocaleString('ru-RU')}`;
                         
                         const successKeyboard = addBackToMenuButton({});
                         bot.sendMessage(msg.chat.id, successText, { 
                             parse_mode: 'Markdown',
                             ...successKeyboard 
                         });
                         
                         // Уведомления в группу о смене статуса отключены по запросу
                         console.log(`✅ Статус участника изменен: ${member.first_name} (${member.old_status} → ${member.new_status})`);
                         
                     } else {
                         const errorKeyboard = addBackToMenuButton({});
                         bot.sendMessage(msg.chat.id, 
                             `❌ Ошибка изменения статуса\n\n` +
                             `📝 Причина: ${result.message}\n\n` +
                             `Попробуйте ещё раз или обратитесь к администратору.`,
                             { 
                                 parse_mode: 'Markdown',
                                 ...errorKeyboard 
                             }
                         );
                     }
                 }
                 break;
                 
            // Обработчики редактирования профиля
            case 'edit_first_name':
                await startEditField(msg, userId, 'first_name', '👤 Изменение имени', 'Введите новое имя:', true);
                break;
                
            case 'edit_last_name':
                await startEditField(msg, userId, 'last_name', '📝 Изменение фамилии', 'Введите новую фамилию (или отправьте любой текст для удаления):');
                break;
                
            case 'edit_birth_date':
                await startEditField(msg, userId, 'birth_date', '🎂 Изменение даты рождения', 'Введите дату рождения в формате ДД.ММ.ГГГГ (например: 15.03.1990):');
                break;
                
            case 'edit_city':
                await startEditField(msg, userId, 'city', '🏙️ Изменение города', 'Введите новый город (или отправьте любой текст для удаления):');
                break;
                
            case 'edit_country':
                await startEditField(msg, userId, 'country', '🌍 Изменение страны', 'Введите новую страну (или отправьте любой текст для удаления):');
                break;
                
            case 'edit_phone':
                await startEditField(msg, userId, 'phone', '📱 Изменение телефона', 'Введите новый номер телефона (или отправьте любой текст для удаления):');
                break;
                
            case 'edit_about':
                await startEditField(msg, userId, 'about', '💭 Изменение описания', 'Расскажите о себе (или отправьте любой текст для удаления):');
                break;
                
            case 'edit_photo':
                await startEditPhoto(msg, userId);
                break;
                
            case 'delete_photo':
                await deleteProfilePhoto(msg, userId);
                break;
                
            default:
                // Проверяем callback_data на специальные паттерны
                // ВАЖНО: Сначала более специфические обработчики, потом общие!
                if (data.startsWith('edit_car_brand_')) {
                    const carId = data.replace('edit_car_brand_', '');
                    await startEditCarField(msg, userId, carId, 'brand', '🏭 Изменение марки', 'Введите новую марку автомобиля:', true);
                } else if (data.startsWith('edit_car_model_')) {
                    const carId = data.replace('edit_car_model_', '');
                    await startEditCarField(msg, userId, carId, 'model', '🚗 Изменение модели', 'Введите новую модель автомобиля:', true);
                } else if (data.startsWith('edit_car_generation_')) {
                    const carId = data.replace('edit_car_generation_', '');
                    await startEditCarField(msg, userId, carId, 'generation', '📋 Изменение поколения', 'Введите поколение автомобиля:');
                } else if (data.startsWith('edit_car_year_')) {
                    const carId = data.replace('edit_car_year_', '');
                    await startEditCarField(msg, userId, carId, 'year', '📅 Изменение года', 'Введите год выпуска автомобиля:', true);
                } else if (data.startsWith('edit_car_reg_number_')) {
                    const carId = data.replace('edit_car_reg_number_', '');
                    await startEditCarField(msg, userId, carId, 'reg_number', '🔢 Изменение номера', 'Введите регистрационный номер автомобиля:');
                } else if (data.startsWith('edit_car_color_')) {
                    const carId = data.replace('edit_car_color_', '');
                    await startEditCarField(msg, userId, carId, 'color', '🎨 Изменение цвета', 'Введите цвет автомобиля:');
                } else if (data.startsWith('edit_car_description_')) {
                    const carId = data.replace('edit_car_description_', '');
                    await startEditCarField(msg, userId, carId, 'description', '💭 Изменение описания', 'Введите описание автомобиля:');
                } else if (data.startsWith('edit_car_add_photo_')) {
                    const carId = data.replace('edit_car_add_photo_', '');
                    await startEditCarPhoto(msg, userId, carId);
                } else if (data.startsWith('edit_car_delete_photo_')) {
                    const carId = data.replace('edit_car_delete_photo_', '');
                    await showDeleteCarPhotoMenu(msg, userId, carId);
                } else if (data === 'continue_adding_photos') {
                    // Пользователь хочет добавить еще фото - просто оставляем состояние как есть
                    bot.sendMessage(msg.chat.id, 
                        '📸 Отправьте следующую фотографию автомобиля\n\n' +
                        '💡 Можете отправить несколько фото подряд!',
                        { parse_mode: 'Markdown' }
                    );
                } else if (data.startsWith('delete_car_photo_') && !data.includes('except_main')) {
                    // Удаление конкретного фото: delete_car_photo_123_0
                    const parts = data.replace('delete_car_photo_', '').split('_');
                    const carId = parts[0];
                    const photoIndex = parseInt(parts[1]);
                    await deleteCarPhoto(msg, userId, carId, photoIndex);
                } else if (data.startsWith('delete_car_photos_except_main_')) {
                    // Удаление всех фото кроме главного
                    const carId = data.replace('delete_car_photos_except_main_', '');
                    await deleteCarPhotosExceptMain(msg, userId, carId);
                } else if (data.startsWith('delete_car_') && !data.includes('photo')) {
                    // Удаление автомобиля (только для админов)
                    const carId = data.replace('delete_car_', '');
                    await showDeleteCarConfirmation(msg, userId, carId);
                } else if (data.startsWith('confirm_delete_car_')) {
                    // Подтверждение удаления автомобиля
                    const carId = data.replace('confirm_delete_car_', '');
                    await deleteCarCompletely(msg, userId, carId);
                } else if (data.startsWith('sell_car_')) {
                    // Продажа автомобиля пользователем
                    const carId = data.replace('sell_car_', '');
                    await showSellCarConfirmation(msg, userId, carId);
                } else if (data.startsWith('confirm_sell_car_')) {
                    // Подтверждение продажи автомобиля
                    const carId = data.replace('confirm_sell_car_', '');
                    await sellCarCompletely(msg, userId, carId);
                } else if (data.startsWith('edit_car_')) {
                    // Общий обработчик должен быть ПОСЛЕДНИМ!
                    const carId = data.replace('edit_car_', '');
                    // Завершаем состояние редактирования фото если оно активно
                    const userState = userStates.get(userId);
                    if (userState && userState.state === 'editing_car' && userState.step === 'add_photo') {
                        userStates.delete(userId);
                    }
                    await showEditCarMenu(msg, userId, carId);
                } else {
                    bot.answerCallbackQuery(callbackQuery.id, '❓ Неизвестная команда');
                }
        }
        
        bot.answerCallbackQuery(callbackQuery.id);
        
    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        bot.answerCallbackQuery(callbackQuery.id, '❌ Произошла ошибка');
    }
});

// Обработчики событий группы

// 1. Когда бота добавляют в группу
bot.on('my_chat_member', async (update) => {
    try {
        const { chat, new_chat_member } = update;
        
        // Проверяем, что это наш бот и его добавили в группу
        if (new_chat_member.user.id === (await bot.getMe()).id && 
            new_chat_member.status === 'member') {
            
            console.log('🔍 Отладка my_chat_member:');
            console.log('Chat ID из события:', chat.id);
            console.log('Chat ID из config:', config.CHAT_ID);
            console.log('Название группы:', chat.title);
            
            // Проверяем, это ли наша группа
            if (chat.id.toString() === config.CHAT_ID.toString()) {
                // Это наша группа - отправляем краткое приветствие
                const welcomeMessage = `🤖 Привет всем!\n\n` +
                    `Я бот клуба кабриолетов! 🚗💨\n\n` +
                    `Мои функции:\n` +
                    `• 👤 Регистрация участников клуба\n` +
                    `• 🚗 Управление автомобилями участников\n` +
                    `• 🎯 Система приглашений новых участников\n` +
                    `• 📊 Статистика и аналитика клуба\n` +
                    `• 🔍 Поиск автомобилей по номерам\n\n` +
                    `Добро пожаловать в клуб! 🎉`;
                
                await bot.sendMessage(chat.id, welcomeMessage, { parse_mode: 'Markdown' });
                console.log('✅ Приветствие отправлено в нашу группу');
            } else {
                // Это чужая группа - отправляем сообщение о том, что бот только для кабриолетчиков
                const wrongGroupMessage = `🤖 Привет!\n\n` +
                    `Я бот клуба кабриолетов, но работаю только для участников нашей группы.\n\n` +
                    `🚗 Если вы любитель кабриолетов, присоединяйтесь к нам:\n` +
                    `👥 [${config.CLUB.groupLink}](${config.CLUB.groupLink})\n\n` +
                    `Там вы сможете:\n` +
                    `• Общаться с единомышленниками\n` +
                    `• Делиться фотографиями своих авто\n` +
                    `• Участвовать в встречах и поездках\n` +
                    `• Использовать все функции бота\n\n` +
                    `До встречи в клубе! 🎉`;
                
                await bot.sendMessage(chat.id, wrongGroupMessage, { parse_mode: 'Markdown' });
                console.log('✅ Сообщение о неправильной группе отправлено');
                
                // Покидаем группу через несколько секунд
                setTimeout(async () => {
                    try {
                        await bot.leaveChat(chat.id);
                        console.log('🚪 Покинули чужую группу:', chat.title);
                    } catch (error) {
                        console.error('❌ Ошибка при покидании группы:', error.message);
                    }
                }, 5000); // 5 секунд задержки
            }
        }
    } catch (error) {
        console.error('Ошибка обработки добавления бота в группу:', error);
    }
});

// 2. Когда нового пользователя добавляют в группу
bot.on('new_chat_members', async (msg) => {
    try {
        const { chat, new_chat_members } = msg;
        
        console.log('🔍 DEBUG new_chat_members START');
        console.log('Chat ID из события:', chat.id);
        console.log('Chat ID из config:', config.CHAT_ID);
        console.log('Сравнение:', chat.id.toString(), '===', config.CHAT_ID.toString());
        console.log('Количество новых участников:', new_chat_members?.length);
        
        // Проверяем, что это наша группа
        if (chat.id.toString() !== config.CHAT_ID.toString()) {
            console.log('❌ ID группы не совпадает, пропускаем событие');
            console.log('Это не наша группа:', chat.title, 'ID:', chat.id);
            return;
        }
        
        console.log('✅ ID группы совпадает, обрабатываем новых участников');
        
        for (const newMember of new_chat_members) {
            // Пропускаем ботов
            if (newMember.is_bot) {
                console.log('🤖 Пропускаем бота:', newMember.first_name);
                continue;
            }
            
            console.log('👤 Обрабатываем участника:', newMember.first_name, 'ID:', newMember.id);
            
            const firstName = newMember.first_name;
            const username = newMember.username ? `@${newMember.username}` : '';
            
            // Проверяем, был ли участник раньше в клубе
            const existingMember = await db.getMemberByTelegramId(newMember.id);
            
            if (existingMember && existingMember.status === 'вышел') {
                // Участник возвращается в клуб
                console.log('🔄 Участник возвращается в клуб:', firstName);
                
                // Восстанавливаем статус всех автомобилей участника
                const cars = await db.getCarsByMemberId(existingMember.id);
                let restoredCarsCount = 0;
                
                for (const car of cars) {
                    if (car.status === 'вышел') {
                        await db.updateCar(car.id, { status: 'активный' });
                        restoredCarsCount++;
                        console.log(`🚗 Восстановлен статус автомобиля: ${car.brand} ${car.model} -> "активный"`);
                    }
                }
                
                // Определяем новый статус участника:
                // Если есть автомобили - "участник", если нет - "без авто"
                const newStatus = restoredCarsCount > 0 ? 'участник' : 'без авто';
                
                // Восстанавливаем статус участника
                await db.updateMember(newMember.id, { 
                    status: newStatus,
                    left_date: null // Убираем дату выхода
                });
                
                // Отправляем сообщение о возвращении
                const statusIcon = newStatus === 'участник' ? '⚪' : '⚪';
                const returnMessage = `🎊 Участник вернулся в клуб!\n\n` +
                    `${firstName}${username ? ` (${username})` : ''} снова с нами!\n\n` +
                    `📊 Новый статус: ${statusIcon} ${newStatus}\n` +
                    `🚗 Восстановлено автомобилей: ${restoredCarsCount}\n\n` +
                    `📊 Статистика обновлена\n\n` +
                    `Добро пожаловать обратно! 🤗`;
                
                await sendGroupNotification(returnMessage);
                console.log('✅ Уведомление о возвращении отправлено');
                
            } else if (existingMember) {
                // Участник уже есть в БД с другим статусом
                console.log('ℹ️ Участник уже зарегистрирован со статусом:', existingMember.status);
                
                const infoMessage = `👋 Участник вернулся в группу\n\n` +
                    `${firstName}${username ? ` (${username})` : ''} снова в чате!\n\n` +
                    `Статус в клубе: ${existingMember.status}`;
                
                await sendGroupNotification(infoMessage);
                
            } else {
                // Новый участник
                console.log('👤 Приветствуем нового участника:', firstName);
                
                const welcomeMessage = `🎉 Добро пожаловать в клуб кабриолетов!\n\n` +
                    `Привет, ${firstName}${username ? ` (${username})` : ''}!\n\n` +
                    `🚗 Рады видеть нового любителя кабриолетов в нашем клубе!\n\n` +
                    `Для начала работы напишите боту [${config.CLUB.botLink}](${config.CLUB.botLink}) в личные сообщения и используйте команду start\n\n` +
                    `Если есть вопросы - обращайтесь к администраторам! 👋`;
                
                await sendGroupNotification(welcomeMessage);
                console.log('✅ Приветственное сообщение отправлено');
            }
        }
        
        console.log('🔍 DEBUG new_chat_members END');
    } catch (error) {
        console.error('Ошибка приветствия новых участников:', error);
        console.log('🔍 DEBUG new_chat_members ERROR END');
    }
});

// Обработка выхода участников из группы
bot.on('left_chat_member', async (msg) => {
    try {
        const { chat, left_chat_member } = msg;
        
        // Проверяем, что это наша группа
        if (chat.id.toString() !== config.CHAT_ID.toString()) {
            console.log('❌ ID группы не совпадает, пропускаем событие выхода');
            return;
        }
        
        // Пропускаем ботов
        if (left_chat_member.is_bot) {
            console.log('🤖 Пропускаем выход бота:', left_chat_member.first_name);
            return;
        }
        
        console.log('👋 Участник покинул группу:', left_chat_member.first_name, 'ID:', left_chat_member.id);
        
        // Ищем участника в базе данных
        const member = await db.getMemberByTelegramId(left_chat_member.id);
        
        if (member) {
            console.log('📝 Найден участник в БД, обновляем статус на "вышел"');
            
            // Обновляем статус участника
            await db.updateMember(left_chat_member.id, { 
                status: 'вышел',
                left_date: new Date().toISOString().split('T')[0] // Дата выхода
            });
            
            // Обновляем статус всех автомобилей участника
            const cars = await db.getCarsByMemberId(member.id);
            for (const car of cars) {
                if (car.status !== 'вышел') {
                    await db.updateCar(car.id, { status: 'вышел' });
                    console.log(`🚗 Обновлен статус автомобиля: ${car.brand} ${car.model} -> "вышел"`);
                }
            }
            
            // Отправляем уведомление в группу
            const firstName = left_chat_member.first_name;
            const username = left_chat_member.username ? `@${left_chat_member.username}` : '';
            
            const farewellMessage = `😔 Участник покинул клуб\n\n` +
                `${firstName}${username ? ` (${username})` : ''} покинул наш клуб.\n\n` +
                `🚗 Автомобили участника (${cars.length}) переведены в статус "вышел"\n\n` +
                `📊 Статистика обновлена\n\n` +
                `Надеемся на скорое возвращение! 🤞`;
            
            await sendGroupNotification(farewellMessage);
            console.log('✅ Уведомление о выходе отправлено');
            
        } else {
            console.log('ℹ️ Участник не найден в БД, возможно не был зарегистрирован');
        }
        
    } catch (error) {
        console.error('Ошибка обработки выхода участника:', error);
    }
});

// Функция показа профиля пользователя
async function showUserProfile(msg, userId) {
    try {
        console.log(`🔍 Поиск пользователя с ID: ${userId}`);
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            console.log(`❌ Пользователь ${userId} не найден в базе данных`);
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🚗 Для доступа к функциям бота необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:', 
                { 
                    parse_mode: 'Markdown',
                    ...keyboard 
                }
            );
            return;
        }
        
        // Специальная обработка для статуса "новый"
        if (member.status === 'новый') {
            const newUserKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Пройти регистрацию', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            let newUserText = `👤 Ваш профиль\n\n`;
            newUserText += `🆕 **Статус: новый**\n`;
            newUserText += `📱 Telegram: ${member.first_name}`;
            if (member.nickname) newUserText += ` (@${member.nickname})`;
            newUserText += `\n📅 Дата входа в группу: ${formatDate(member.join_date)}\n\n`;
            newUserText += `⚠️ **Для завершения вступления в клуб необходимо пройти регистрацию**\n\n`;
            newUserText += `📋 При регистрации вы заполните:\n`;
            newUserText += `• Имя и фамилию\n`;
            newUserText += `• Дату рождения\n`;
            newUserText += `• Город проживания\n`;
            newUserText += `• Контактный телефон\n`;
            newUserText += `• Фотографию профиля\n\n`;
            newUserText += `✨ После регистрации вы получите статус "без авто" и сможете добавлять автомобили!`;
            
            bot.sendMessage(msg.chat.id, newUserText, { 
                parse_mode: 'Markdown', 
                ...newUserKeyboard 
            });
            return;
        }
        
        // Обычный профиль для зарегистрированных пользователей
        let profileText = `👤 Ваш профиль\n\n`;
        profileText += `Имя: ${member.first_name}`;
        if (member.last_name) profileText += ` ${member.last_name}`;
        profileText += `\nСтатус: ${member.status}`;
        profileText += `\nДата вступления: ${formatDate(member.join_date)}`;
        if (member.left_date) profileText += `\nДата выхода: ${formatDate(member.left_date)}`;
        
        if (member.nickname) profileText += `\nНикнейм: ${member.nickname}`;
        if (member.alias) profileText += `\nПозывной: ${member.alias}`;
        if (member.city) profileText += `\nГород: ${member.city}`;
        if (member.country) profileText += `\nСтрана: ${member.country}`;
        if (member.phone) profileText += `\nТелефон: ${member.phone}`;
        if (member.about) profileText += `\n\nО себе: ${member.about}`;
        
        // Создаем клавиатуру в зависимости от статуса пользователя (все кнопки по одной в строку)
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }]
                ]
            }
        };

        // Добавляем кнопку "получить активный статус" для участников со статусом "участник" или "без авто"
        if ((member.status === 'участник' || member.status === 'без авто') && member.status !== 'активный') {
            keyboard.reply_markup.inline_keyboard.push([
                { text: '🎯 Получить активный статус', callback_data: 'get_active_status' }
            ]);
        }

        // Всегда добавляем кнопку "Назад в меню"
        keyboard.reply_markup.inline_keyboard.push([
            { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
        ]);
        
        // Если есть фото профиля, отправляем с фото
        if (member.photo_url && member.photo_url.trim() !== '') {
            try {
                console.log('👤 Отправляем фото профиля:');
                console.log('   Photo URL from DB:', member.photo_url);
                
                const fs = require('fs');
                const path = require('path');
                const photoPath = path.resolve(config.UPLOADS.membersPath, member.photo_url);
                console.log('   Resolved Photo Path:', photoPath);
                console.log('   File exists:', fs.existsSync(photoPath));
                
                if (fs.existsSync(photoPath)) {
                    console.log('   Отправляем фото профиля...');
                    const photoStream = fs.createReadStream(photoPath);
                    await bot.sendPhoto(msg.chat.id, photoStream, {
                        caption: profileText,
                        parse_mode: 'Markdown',
                        ...keyboard
                    }, {
                        contentType: 'image/jpeg'
                    });
                    console.log('   ✅ Фото профиля отправлено');
                } else {
                    console.log('   ❌ Файл фото профиля не найден');
                    // Если файл не найден, отправляем текст
                    bot.sendMessage(msg.chat.id, profileText + '\n\n📷 Фото профиля не найдено', {
                        parse_mode: 'Markdown', 
                        ...keyboard 
                    });
                }
            } catch (error) {
                console.error('❌ Ошибка отправки фото профиля:');
                console.error('   Photo URL:', member.photo_url);
                console.error('   Error:', error);
                bot.sendMessage(msg.chat.id, profileText + '\n\n📷 Ошибка загрузки фото', {
                    parse_mode: 'Markdown', 
                    ...keyboard 
                });
            }
        } else {
            // Без фото
            bot.sendMessage(msg.chat.id, profileText, { 
                parse_mode: 'Markdown', 
                ...keyboard 
            });
        }
        
    } catch (error) {
        console.error('Ошибка показа профиля:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки профиля');
    }
}

// Функция показа автомобилей пользователя
async function showUserCars(msg, userId) {
    try {
        console.log(`🔍 Поиск пользователя для показа авто с ID: ${userId}`);
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            console.log(`❌ Пользователь ${userId} не найден при показе авто`);
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🚗 Для просмотра автомобилей необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:', 
                { 
                    parse_mode: 'Markdown',
                    ...keyboard 
                }
            );
            return;
        }
        
        const cars = await db.getCarsByMemberId(member.id);
        
        if (cars.length === 0) {
            const noCarsKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Добавить авто', callback_data: 'add_car' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🚗 У вас пока нет добавленных автомобилей.\n\n' +
                'Используйте кнопку "📝 Добавить авто" для добавления первого автомобиля.',
                noCarsKeyboard
            );
            return;
        }
        
        // Отправляем каждый автомобиль отдельным сообщением с фото и кнопками редактирования
        for (let i = 0; i < cars.length; i++) {
            const car = cars[i];
            
            let carText = `🚗 Автомобиль ${i + 1} из ${cars.length}\n\n`;
            carText += `${car.brand} ${car.model}`;
            if (car.generation) carText += ` (${car.generation})`;
            carText += `\n📅 Год: ${car.year}`;
            if (car.reg_number) carText += `\n🔢 Номер: ${car.reg_number}`;
            if (car.color) carText += `\n🎨 Цвет: ${car.color}`;
            carText += `\n📊 Статус: ${car.status}`;
            if (car.description) carText += `\n💭 ${car.description}`;
            
            // Создаем кнопки для каждого автомобиля
            const carKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✏️ Редактировать авто', callback_data: `edit_car_${car.id}` }],
                        [{ text: '💸 Продать авто', callback_data: `sell_car_${car.id}` }]
                    ]
                }
            };
            
            // Проверяем наличие фотографий
            if (car.photos && car.photos.trim() !== '') {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const photos = JSON.parse(car.photos);
                    
                    if (photos && photos.length > 0) {
                        // Берем первое фото для отображения
                        const firstPhoto = photos[0];
                        const photoPath = path.resolve(config.UPLOADS.carsPath, firstPhoto);
                        
                        if (fs.existsSync(photoPath)) {
                            if (photos.length > 1) {
                                carText += `\n📷 Фото: 1 из ${photos.length}`;
                            }
                            
                            const carPhotoStream = fs.createReadStream(photoPath);
                            await bot.sendPhoto(msg.chat.id, carPhotoStream, {
                                caption: carText,
                                parse_mode: 'Markdown',
                                ...carKeyboard
                            }, {
                                contentType: 'image/jpeg'
                            });
                        } else {
                            carText += `\n📷 Фото не найдено`;
                            await bot.sendMessage(msg.chat.id, carText, { 
                                parse_mode: 'Markdown',
                                ...carKeyboard 
                            });
                        }
                    } else {
                        await bot.sendMessage(msg.chat.id, carText, { 
                            parse_mode: 'Markdown',
                            ...carKeyboard 
                        });
                    }
                } catch (error) {
                    console.error('Ошибка отправки фото автомобиля:', error);
                    carText += `\n📷 Ошибка загрузки фото`;
                    await bot.sendMessage(msg.chat.id, carText, { 
                        parse_mode: 'Markdown',
                        ...carKeyboard 
                    });
                }
            } else {
                await bot.sendMessage(msg.chat.id, carText, { 
                    parse_mode: 'Markdown',
                    ...carKeyboard 
                });
            }
            
            // Небольшая задержка между сообщениями
            if (i < cars.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Добавляем кнопку "Назад в меню" после всех автомобилей
        const backKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, '🔽 Все ваши автомобили показаны выше', {
            parse_mode: 'Markdown',
            ...backKeyboard 
        });
        
    } catch (error) {
        console.error('Ошибка показа автомобилей:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки автомобилей');
    }
}

// Функция показа статистики
async function showStats(msg) {
    try {
        const stats = await db.getExtendedStats();
        
        if (!stats) {
            bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки статистики');
            return;
        }
        
        let statsText = `📊 Статистика клуба\n\n`;
        
        // Основные участники
        statsText += `👥 **Участники клуба:** ${stats.totalActiveMembers}\n`;
        statsText += `🆕 Новые: ${stats.новый}\n`;
        statsText += `⚪ Без авто: ${stats.без_авто}\n`;
        statsText += `⚪ Участники: ${stats.участник}\n`;
        statsText += `✅ Активные: ${stats.активный}\n\n`;
        
        // Автомобили и приглашения
        statsText += `🚗 **Автомобилей:** ${stats.totalCars}\n`;
        statsText += `📮 **Приглашений:** ${stats.totalInvitations}\n\n`;
        
        // Ограниченный доступ
        if (stats.totalRestrictedMembers > 0) {
            statsText += `🚫 **Ограниченный доступ:** ${stats.totalRestrictedMembers}\n`;
            if (stats.вышел > 0) statsText += `👋 Вышли: ${stats.вышел}\n`;
            if (stats.бан > 0) statsText += `🚫 Заблокированы: ${stats.бан}\n\n`;
        }
        
        // Общий итог
        statsText += `📈 **Всего в системе:** ${stats.totalMembers} участников`;
        
        const statsKeyboard = addBackToMenuButton({});
        bot.sendMessage(msg.chat.id, statsText, { 
            parse_mode: 'Markdown',
            ...statsKeyboard 
        });
        
    } catch (error) {
        console.error('Ошибка показа статистики:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки статистики');
    }
}

// Функция обработки веб-дашборда
async function handleWebDashboard(msg, userId) {
    try {
        // Получаем данные пользователя из базы
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе.\n' +
                'Для доступа к веб-дашборду сначала пройдите регистрацию через команду /register'
            );
            return;
        }
        
        if (member.status === 'вышел') {
            bot.sendMessage(msg.chat.id, 
                '❌ Ваш статус в клубе: "вышел".\n' +
                'Для доступа к веб-дашборду обратитесь к администратору для восстановления доступа.'
            );
            return;
        }
        
        // Генерируем ссылку с параметрами авторизации
        const timestamp = Math.floor(Date.now() / 1000);
        const hash = require('crypto').createHmac('sha256', config.BOT_TOKEN)
            .update(`${userId}:${timestamp}`)
            .digest('hex');
        
        const authUrl = `https://club.cabrioride.by/auto-auth.html?user_id=${userId}&timestamp=${timestamp}&hash=${hash}`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🌐 Открыть веб-дашборд', url: authUrl }
                    ],
                    [
                        { text: '🔙 Назад в меню', callback_data: 'menu' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            `🌐 Веб-дашборд Cabrio Club\n\n` +
            `Добро пожаловать, ${member.first_name}!\n\n` +
            `🎯 Что доступно в веб-дашборде:\n` +
            `• 📊 Статистика клуба в реальном времени\n` +
            `• 👥 Список всех участников с фото\n` +
            `• 🚗 Каталог автомобилей клуба\n` +
            `• 📨 История приглашений\n` +
            `• 🔍 Удобные фильтры и поиск\n\n` +
            `🔐 Безопасность:\n` +
            `• Автоматическая авторизация через Telegram\n` +
            `• Доступ только для участников клуба\n` +
            `• Персонализированный интерфейс\n\n` +
            `👆 Нажмите кнопку ниже для входа:`,
            { 
                parse_mode: 'Markdown',
                ...keyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка обработки веб-дашборда:', error);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка при генерации ссылки на веб-дашборд.');
    }
}

// Функция показа помощи
async function showHelp(msg) {
    const userId = msg.from.id;
    const isUserAdmin = isAdmin(userId);
    
    let helpText = `❓ Помощь по использованию бота\n\n` +
        `🚀 Основные команды:\n` +
        `/start - Запуск бота и приветствие\n` +
        `/menu - Главное меню с кнопками\n` +
        `/register - Регистрация в клубе\n` +
        `/help - Эта справка\n\n` +
        `👤 Профиль и автомобили:\n` +
        `/profile - Мой профиль\n` +
        `/cars - Мои автомобили\n` +
        `/addcar - Добавить автомобиль\n\n` +
        `🎯 Приглашения:\n` +
        `/invite - Создать приглашение\n` +
        `/myinvites - Мои приглашения\n` +
        `/search - Поиск по номеру\n\n` +
        `📊 Информация:\n` +
        `/stats - Статистика клуба\n\n` +
        `🔧 Служебные команды:\n` +
        `/skip - Пропустить шаг (в процессах)\n` +
        `/done - Завершить загрузку фото\n`;
    
    // Добавляем админские команды если пользователь админ
    if (isUserAdmin) {
        helpText += `\n🔒 Команды администратора:\n` +
            `/status - Системная диагностика\n` +
            `/admintest - Тест админских прав\n`;
    }
    
    helpText += `\n💡 Совет: Используйте /menu для удобного доступа ко всем функциям через кнопки!\n\n` +
        `🆘 Поддержка:\n` +
        `Если у вас возникли проблемы, обратитесь к администраторам в чате клуба.`;
    
    if (isUserAdmin) {
        helpText += `\n\n🔧 Вы авторизованы как администратор бота`;
    }
    
    const helpKeyboard = addBackToMenuButton({});
    bot.sendMessage(msg.chat.id, helpText, { 
        parse_mode: 'Markdown',
        ...helpKeyboard 
    });
}

// Обработка текстовых сообщений для многошаговых операций
bot.on('message', async (msg) => {
    // Игнорируем команды (они обрабатываются отдельно)
    if (msg.text && msg.text.startsWith('/')) return;
    
    // Обрабатываем только текстовые сообщения (фото обрабатываются отдельно)
    if (!msg.text) return;
    
    // Проверяем доступ - только членство пользователя в группе
    if (!await checkUserMembership(msg.from.id)) return;
    
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    console.log(`📝 Получено сообщение от пользователя ${userId}: "${msg.text}"`);
    console.log(`🗺️ Размер userStates Map:`, userStates.size);
    console.log(`🔍 Состояние пользователя:`, userState);
    console.log(`🔍 Все состояния:`, Array.from(userStates.entries()));
    
    if (!userState) {
        console.log(`❌ Нет активного состояния для пользователя ${userId}`);
        return; // Нет активного состояния
    }
    
    try {
        if (userState.state === 'registration') {
            await handleRegistration(msg, userId, userState);
        } else if (userState.state === 'adding_car') {
            await handleAddCar(msg, userId, userState);
        } else if (userState.state === 'creating_invitation') {
            await handleCreateInvitation(msg, userId, userState);
        } else if (userState.state === 'searching') {
            await handleSearch(msg, userId, userState);
        } else if (userState.state === 'setting_user_status') {
            await handleSetUserStatus(msg, userId, userState);
        } else if (userState.state === 'setting_password') {
            await handlePasswordSetting(msg, userId, userState);
        } else if (userState.state === 'entering_password') {
            await handlePasswordEntering(msg, userId, userState);
        } else if (userState.state === 'editing_profile') {
            await handleEditProfile(msg, userId, userState);
        } else if (userState.state === 'editing_car') {
            await handleEditCar(msg, userId, userState);
        }
    } catch (error) {
        console.error('Ошибка обработки сообщения:', error);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка. Попробуйте ещё раз.');
        userStates.delete(userId);
    }
});

// Обработка фотографий
bot.on('photo', async (msg) => {
    // Проверяем доступ
    if (!await checkChatMembership(msg.from.id)) return;
    
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, '📸 Красивое фото! Но сейчас я не жду фотографий.\nИспользуйте /menu для доступа к функциям.');
        return;
    }
    
    try {
        if (userState.state === 'registration') {
            await handlePhotoRegistration(msg, userId, userState);
        } else if (userState.state === 'adding_car') {
            await handleCarPhoto(msg, userId, userState);
        } else if (userState.state === 'creating_invitation') {
            await handleInvitationPhoto(msg, userId, userState);
        } else if (userState.state === 'editing_profile' && userState.step === 'enter_photo') {
            await handleEditProfilePhoto(msg, userId, userState);
        } else if (userState.state === 'editing_car' && userState.step === 'add_photo') {
            await handleEditCarPhoto(msg, userId, userState);
        }
    } catch (error) {
        console.error('Ошибка обработки фото:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка при обработке фотографии. Попробуйте ещё раз.');
    }
});

// Обработка процесса регистрации
async function handleRegistration(msg, userId, userState) {
    const step = userState.step;
    const data = userState.data || {};
    
    switch (step) {
        case 'name':
            data.first_name = msg.text.trim();
            userState.data = data;
            userState.step = 'last_name';
            userStates.set(userId, userState);
            
            const lastNameKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                `Приятно познакомиться, ${data.first_name}! 👋\n\n` +
                '👤 Введите вашу фамилию:', 
                { 
                    parse_mode: 'Markdown',
                    ...lastNameKeyboard 
                }
            );
            break;
            
        case 'last_name':
            data.last_name = msg.text.trim();
            userState.data = data;
            userState.step = 'birth_date';
            userStates.set(userId, userState);
            
            const birthDateKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🎂 Шаг 3 из 8: Введите вашу дату рождения\n\n' +
                'Формат: ДД.ММ.ГГГГ (например: 15.03.1990)', 
                { 
                    parse_mode: 'Markdown',
                    ...birthDateKeyboard 
                }
            );
            break;
            
        case 'birth_date':
            const birthDateInput = msg.text.trim();
            
            console.log('🔍 Отладка birth_date:');
            console.log('  Введенная дата:', birthDateInput);
            
            // Валидируем дату рождения
            const birthDateValidation = validateBirthDate(birthDateInput);
            console.log('  Результат валидации:', birthDateValidation);
            
            if (!birthDateValidation.valid) {
                bot.sendMessage(msg.chat.id, 
                    `❌ ${birthDateValidation.error}\n\n` +
                    '🎂 Введите дату рождения в формате ДД.ММ.ГГГГ\n' +
                    'Например: 15.03.1990', 
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            data.birth_date = birthDateValidation.date;
            console.log('  Сохраненная дата:', data.birth_date);
            userState.data = data;
            userState.step = 'city';
            userStates.set(userId, userState);
            
            const cityKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🏙️ Шаг 4 из 8: В каком городе вы живёте?', 
                { 
                    parse_mode: 'Markdown',
                    ...cityKeyboard 
                }
            );
            break;
            
        case 'city':
            data.city = msg.text.trim();
            userState.data = data;
            userState.step = 'country';
            userStates.set(userId, userState);
            
            const countryKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить (Беларусь)', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🌍 Шаг 5 из 8: В какой стране вы живёте?\n\n' +
                'Наш клуб базируется в Минске, Беларусь.\n' +
                'Примеры: Беларусь, Россия, Казахстан, Украина', 
                { 
                    parse_mode: 'Markdown',
                    ...countryKeyboard 
                }
            );
            break;
            
        case 'country':
            data.country = msg.text.trim();
            userState.data = data;
            userState.step = 'phone';
            userStates.set(userId, userState);
            
            const phoneKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📱 Шаг 5 из 8: Введите ваш номер телефона\n\n' +
                'Например: +375 (33) 993-22-88', 
                { 
                    parse_mode: 'Markdown',
                    ...phoneKeyboard 
                }
            );
            break;
            
        case 'phone':
            data.phone = msg.text.trim();
            userState.data = data;
            userState.step = 'about';
            userStates.set(userId, userState);
            
            const aboutKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📝 Расскажите немного о себе\n\n' +
                'Какие у вас автомобили? Как давно увлекаетесь кабриолетами?', 
                { 
                    parse_mode: 'Markdown',
                    ...aboutKeyboard 
                }
            );
            break;
            
        case 'about':
            data.about = msg.text.trim();
            userState.data = data;
            userState.step = 'photo';
            userStates.set(userId, userState);
            
            const photoKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить фото', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📸 Загрузите ваше фото для профиля\n\n' +
                'Это поможет другим участникам узнать вас!', 
                { 
                    parse_mode: 'Markdown',
                    ...photoKeyboard 
                }
            );
            break;
            
        case 'photo':
            // Пользователь ввел текст вместо фото
            // (фото обрабатывается отдельно в bot.on('photo') -> handlePhotoRegistration)
            const photoSkipKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить фото', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📸 Пожалуйста, отправьте фотографию или нажмите кнопку "Пропустить"', 
                photoSkipKeyboard
            );
            break;
    }
}

// Обработка пропуска шага в регистрации
async function handleRegistrationSkip(msg, userId, userState) {
    const step = userState.step;
    const data = userState.data || {};
    
    switch (step) {
        case 'last_name':
            // Пропускаем фамилию
            userState.data = data;
            userState.step = 'birth_date';
            userStates.set(userId, userState);
            
            const birthDateKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🎂 Шаг 3 из 8: Введите вашу дату рождения\n\n' +
                'Формат: ДД.ММ.ГГГГ (например: 15.03.1990)', 
                { 
                    parse_mode: 'Markdown',
                    ...birthDateKeyboard 
                }
            );
            break;
            
        case 'birth_date':
            // Пропускаем дату рождения
            userState.data = data;
            userState.step = 'city';
            userStates.set(userId, userState);
            
            const cityKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🏙️ Шаг 4 из 8: В каком городе вы живёте?', 
                { 
                    parse_mode: 'Markdown',
                    ...cityKeyboard 
                }
            );
            break;
            
        case 'city':
            // Пропускаем город
            userState.data = data;
            userState.step = 'country';
            userStates.set(userId, userState);
            
            const countryKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить (Беларусь)', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🌍 В какой стране вы живёте?\n\n' +
                'Наш клуб базируется в Минске, Беларусь.\n' +
                'Примеры: Беларусь, Россия, Казахстан, Украина', 
                { 
                    parse_mode: 'Markdown',
                    ...countryKeyboard 
                }
            );
            break;
            
        case 'country':
            // Пропускаем страну, устанавливаем Беларусь по умолчанию
            data.country = 'Беларусь';
            userState.data = data;
            userState.step = 'phone';
            userStates.set(userId, userState);
            
            const phoneKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📱 Шаг 5 из 8: Введите ваш номер телефона\n\n' +
                'Например: +375 (33) 993-22-88', 
                { 
                    parse_mode: 'Markdown',
                    ...phoneKeyboard 
                }
            );
            break;
            
        case 'phone':
            // Пропускаем телефон
            userState.data = data;
            userState.step = 'about';
            userStates.set(userId, userState);
            
            const aboutKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📝 Расскажите немного о себе\n\n' +
                'Какие у вас автомобили? Как давно увлекаетесь кабриолетами?', 
                { 
                    parse_mode: 'Markdown',
                    ...aboutKeyboard 
                }
            );
            break;
            
        case 'about':
            // Пропускаем описание
            userState.data = data;
            userState.step = 'photo';
            userStates.set(userId, userState);
            
            const photoKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить фото', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📸 Загрузите ваше фото для профиля\n\n' +
                'Это поможет другим участникам узнать вас!', 
                { 
                    parse_mode: 'Markdown',
                    ...photoKeyboard 
                }
            );
            break;
            
        case 'photo':
            // Пропускаем фото и завершаем регистрацию
            await completeRegistration(msg, userId, data);
            break;
            
        default:
            bot.sendMessage(msg.chat.id, '❌ Неизвестный шаг регистрации');
            userStates.delete(userId);
            break;
    }
}

// Обработка пропуска шага в создании приглашения
async function handleInvitationSkip(msg, userId, userState) {
    const step = userState.step;
    const data = userState.data || {};
    
    switch (step) {
        case 'photos':
            // Пропускаем фото и завершаем создание приглашения
            await completeCreateInvitation(msg, userId, data);
            break;
            
        default:
            bot.sendMessage(msg.chat.id, '❌ Неизвестный шаг создания приглашения');
            userStates.delete(userId);
            break;
    }
}

// Завершение регистрации
async function completeRegistration(msg, userId, data) {
    try {
        console.log('🔍 Отладка completeRegistration:');
        console.log('userId:', userId);
        console.log('data:', JSON.stringify(data, null, 2));
        console.log('msg.from.username:', msg.from.username);
        
        // Сначала проверяем, есть ли уже запись (должна быть создана при первом обращении)
        const existingMember = await db.getMemberByTelegramId(userId);
        
        if (existingMember) {
            // Обновляем существующую запись данными регистрации
            const updateData = {
                first_name: data.first_name,
                last_name: data.last_name || null,
                birth_date: data.birth_date || null,
                phone: data.phone || null,
                city: data.city || null,
                country: data.country || 'Беларусь',
                about: data.about || null,
                status: 'без авто' // Меняем статус с "новый" на "без авто"
            };
            
            // Обновляем фото только если загружено новое
            if (data.photo_url) {
                updateData.photo_url = data.photo_url;
            }
            
            const updateResult = await db.updateMember(userId, updateData);
            
            if (updateResult.affectedRows === 0) {
                throw new Error('Не удалось обновить данные участника');
            }
            
            // Получаем обновленные данные для отображения
            const updatedMember = await db.getMemberByTelegramId(userId);
            var newMember = updatedMember;
            
            console.log(`✅ Обновлена запись участника: ${data.first_name} (${userId}) - статус изменен с "${existingMember.status}" на "без авто"`);
        } else {
            // Создаем новую запись (резервный вариант)
            const memberData = {
                telegram_id: userId,
                first_name: data.first_name,
                last_name: data.last_name || null,
                birth_date: data.birth_date || null,
                nickname: msg.from.username || null,
                phone: data.phone || null,
                city: data.city || null,
                country: data.country || 'Беларусь',
                about: data.about || null,
                photo_url: data.photo_url || null,
                join_date: new Date().toISOString().split('T')[0],
                status: 'без авто'
            };
            
            var newMember = await db.createMember(memberData);
            console.log(`✅ Создана новая запись участника: ${data.first_name} (${userId}) со статусом "без авто"`);
        }
        
        // Проверяем, удалось ли сохранить данные
        if (!newMember) {
            console.error('❌ Не удалось сохранить данные участника в БД');
            userStates.delete(userId);
            
            bot.sendMessage(msg.chat.id, 
                '❌ Ошибка сохранения данных\n\n' +
                '🔧 База данных временно недоступна.\n' +
                'Ваши данные не были сохранены.\n\n' +
                '🔄 Пожалуйста, попробуйте зарегистрироваться позже командой /register\n\n' +
                '📞 Если проблема повторится, обратитесь к администратору.',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Удаляем состояние пользователя
        userStates.delete(userId);
        
        // Отправляем подтверждение
        let confirmationText = '🎉 Регистрация завершена успешно!\n\n';
        confirmationText += `👤 ${newMember.first_name}`;
        if (newMember.last_name) confirmationText += ` ${newMember.last_name}`;
        if (newMember.city) confirmationText += `\n🏙️ Город: ${newMember.city}`;
        if (newMember.country) confirmationText += `\n🌍 Страна: ${newMember.country}`;
        if (newMember.phone) confirmationText += `\n📱 Телефон: ${newMember.phone}`;
        confirmationText += `\n📅 Дата: ${formatDate(newMember.join_date)}`;
        confirmationText += `\n📊 Статус: ${newMember.status}`;
        
        confirmationText += '\n\n🚗 Теперь вы можете:';
        confirmationText += '\n• Добавить свои автомобили';
        confirmationText += '\n• Приглашать новых участников';
        confirmationText += '\n• Участвовать в жизни клуба';
        
        confirmationText += '\n\nИспользуйте /menu для доступа ко всем функциям!';
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📋 Главное меню', callback_data: 'menu' },
                        { text: '🚗 Добавить авто', callback_data: 'add_car' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, confirmationText, { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
        
        console.log(`✅ Участник завершил регистрацию: ${newMember.first_name} (ID: ${userId})`);
        
        // Получаем информацию о возможности отправки в группу из userState
        const userState = userStates.get(userId);
        const canSendToGroup = userState && userState.groupAccess;
        
        // Отправляем уведомление в группу только если бот может отправлять сообщения
        if (canSendToGroup) {
            let groupNotification = `📝 Участник завершил регистрацию!\n\n`;
            groupNotification += `👤 ${newMember.first_name}`;
            if (newMember.last_name) groupNotification += ` ${newMember.last_name}`;
            if (newMember.nickname) groupNotification += ` (@${newMember.nickname})`;
            if (newMember.city) groupNotification += `\n🏙️ ${newMember.city}`;
            if (newMember.country) groupNotification += `\n🌍 ${newMember.country}`;
            if (newMember.about) groupNotification += `\n\n💭 ${newMember.about}`;
            
            groupNotification += `\n\n📊 Статус: ${newMember.status}`;
            groupNotification += `\n🚗 Ждём информацию об автомобилях!`;
            
            try {
                // Отправляем фото профиля если есть
                if (newMember.photo_url) {
                    const fs = require('fs');
                    const path = require('path');
                    const photoPath = path.resolve(config.UPLOADS.membersPath, newMember.photo_url);
                    
                    console.log('📸 Отладка фото регистрации:');
                    console.log('newMember.photo_url:', newMember.photo_url);
                    console.log('photoPath:', photoPath);
                    console.log('fs.existsSync(photoPath):', fs.existsSync(photoPath));
                    
                    if (fs.existsSync(photoPath)) {
                        console.log('✅ Отправляем фото профиля в группу');
                        await sendGroupPhoto(photoPath, groupNotification, {}, 'new_member');
                    } else {
                        console.log('⚠️ Файл фото профиля не найден:', photoPath);
                        await sendGroupNotification(groupNotification, {}, 'new_member');
                    }
                } else {
                    console.log('ℹ️ У участника нет фото профиля');
                    await sendGroupNotification(groupNotification, {}, 'new_member');
                }
            } catch (error) {
                console.error('❌ Ошибка отправки уведомления в группу:', error);
                // Не прерываем процесс регистрации из-за ошибки отправки в группу
            }
        } else {
            console.log('⚠️ Уведомление в группу не отправлено - бот не может отправлять сообщения в группу');
        }
        
    } catch (error) {
        console.error('Ошибка завершения регистрации:', error);
        userStates.delete(userId);
        
        bot.sendMessage(msg.chat.id, 
            '❌ Произошла ошибка при сохранении данных.\n' +
            'Пожалуйста, попробуйте зарегистрироваться ещё раз командой /register\n\n' +
            'Если проблема повторится, обратитесь к администратору.'
        );
    }
}

// Функция показа приглашений пользователя
async function showUserInvitations(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            const notRegisteredKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🚗 Для просмотра приглашений необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:',
                { 
                    parse_mode: 'Markdown',
                    ...notRegisteredKeyboard 
                }
            );
            return;
        }
        
        const invitations = await db.getInvitationsByInviter(member.id);
        
        if (invitations.length === 0) {
            const noInvitationsKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎯 Новое приглашение', callback_data: 'create_invitation' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📮 У вас пока нет приглашений.\n\n' +
                'Используйте кнопку "🎯 Оставить приглашение" когда увидите незнакомый кабриолет!',
                noInvitationsKeyboard
            );
            return;
        }
        
        let invitationsText = `📮 Ваши приглашения (${invitations.length})\n\n`;
        
        invitations.forEach((invitation, index) => {
            invitationsText += `🚗 ${invitation.brand} ${invitation.model}`;
            if (invitation.reg_number) invitationsText += ` (${invitation.reg_number})`;
            invitationsText += `\n📅 Дата: ${formatDate(invitation.invitation_date)}`;
            invitationsText += `\n📍 Место: ${invitation.location}`;
            invitationsText += `\n📊 Статус: ${invitation.status}`;
            if (invitation.contact_name) invitationsText += `\n📱 Контакты: ${invitation.contact_name}`;
            if (invitation.notes) invitationsText += `\n📝 ${invitation.notes}`;
            invitationsText += `\n\n`;
        });
        
        // Добавляем статистику
        const statusCounts = invitations.reduce((acc, inv) => {
            acc[inv.status] = (acc[inv.status] || 0) + 1;
            return acc;
        }, {});
        
        invitationsText += `📊 Статистика по статусам:\n`;
        Object.entries(statusCounts).forEach(([status, count]) => {
            invitationsText += `• ${status}: ${count}\n`;
        });
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔍 Поиск по номеру', callback_data: 'search_by_number' },
                        { text: '🎯 Новое приглашение', callback_data: 'create_invitation' }
                    ],
                    [
                        { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, invitationsText, { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
        
    } catch (error) {
        console.error('Ошибка показа приглашений:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки приглашений');
    }
}

async function startAddCar(msg, userId) {
    try {
        // Проверяем статус пользователя
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            const notRegisteredKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🚗 Для добавления автомобилей необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:',
                { 
                    parse_mode: 'Markdown',
                    ...notRegisteredKeyboard 
                }
            );
            return;
        }
        
        // Запрещаем добавление автомобилей пользователям со статусом "новый"
        if (member.status === 'новый') {
            const newUserCarKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Пройти регистрацию', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🚫 Добавление автомобилей недоступно\n\n' +
                '⚠️ Ваш статус: **новый**\n\n' +
                '📋 Для добавления автомобилей необходимо:\n' +
                '1️⃣ Пройти регистрацию в клубе\n' +
                '2️⃣ Получить статус "без авто" или выше\n\n' +
                '✨ После регистрации вы сможете добавлять автомобили!',
                { 
                    parse_mode: 'Markdown',
                    ...newUserCarKeyboard 
                }
            );
            return;
        }
        
        userStates.set(userId, { state: 'adding_car', step: 'brand' });
        const addCarKeyboard = addBackToMenuButton({});
        bot.sendMessage(msg.chat.id, 
            '🚗 Добавление нового автомобиля\n\n' +
            'Введите марку автомобиля (например: BMW, Mercedes-Benz, Audi):',
            { 
                parse_mode: 'Markdown',
                ...addCarKeyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка проверки статуса при добавлении авто:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Попробуйте позже.');
    }
}

async function startCreateInvitation(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            const notRegisteredInviteKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🎯 Для создания приглашений необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:',
                { 
                    parse_mode: 'Markdown',
                    ...notRegisteredInviteKeyboard 
                }
            );
            return;
        }
        
        userStates.set(userId, { 
            state: 'creating_invitation', 
            step: 'reg_number',
            data: { inviter_member_id: member.id }
        });
        
        const createInvitationKeyboard = addBackToMenuButton({});
        bot.sendMessage(msg.chat.id, 
            '🎯 Создание приглашения\n\n' +
            'Вы увидели незнакомый кабриолет и оставили визитку?\n' +
            'Давайте зафиксируем это!\n\n' +
            '🔢 Введите регистрационный номер автомобиля:\n' +
            'Формат: только цифры и латинские буквы без пробелов\n' +
            'Например: A123BC77, 1234AB199\n\n' +
            '⚠️ Это обязательное поле!',
            { 
                parse_mode: 'Markdown',
                ...createInvitationKeyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка создания приглашения:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Попробуйте позже.');
    }
}

// Обработка добавления автомобиля (базовая версия)
async function handleAddCar(msg, userId, userState) {
    const step = userState.step;
    const data = userState.data || {};
    
    switch (step) {
        case 'brand':
            data.brand = msg.text.trim();
            userState.data = data;
            userState.step = 'model';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                `Отлично! Марка: ${data.brand} ✅\n\n` +
                'Теперь введите модель автомобиля:'
            );
            break;
            
        case 'model':
            data.model = msg.text.trim();
            userState.data = data;
            userState.step = 'year';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                `Модель: ${data.model} ✅\n\n` +
                'Введите год выпуска:'
            );
            break;
            
        case 'year':
            const year = parseInt(msg.text.trim());
            if (isNaN(year) || year < 1950 || year > new Date().getFullYear() + 1) {
                bot.sendMessage(msg.chat.id, 
                    '❌ Пожалуйста, введите корректный год (например: 2010):'
                );
                return;
            }
            
            data.year = year;
            userState.data = data;
            userState.step = 'reg_number';
            userStates.set(userId, userState);
            
            const regNumberKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                `Год: ${data.year} ✅\n\n` +
                '🚗 Введите регистрационный номер автомобиля\n' +
                'Формат: только цифры и латинские буквы без пробелов\n' +
                'Например: A123BC77, 1234AB199',
                regNumberKeyboard
            );
            break;
            
        case 'reg_number':
            // Обработка регистрационного номера - /skip теперь обрабатывается через callback_data
            {
                // Валидация номера
                const validation = validateRegNumber(msg.text);
                
                if (!validation.valid) {
                    const validationErrorKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '⏭️ Пропустить', callback_data: 'skip_step' }]
                            ]
                        }
                    };
                    
                    bot.sendMessage(msg.chat.id, 
                        `❌ ${validation.error}\n\n` +
                        'Примеры правильных номеров:\n' +
                        '• A123BC77\n' +
                        '• 1234AB199\n' +
                        '• H001AA\n\n' +
                        'Попробуйте ещё раз:',
                        validationErrorKeyboard
                    );
                    return;
                }
                
                data.reg_number = validation.number;
                userState.data = data;
                userState.step = 'photos';
                userStates.set(userId, userState);
                
                const carPhotosKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Закончить', callback_data: 'finish_photos' },
                                { text: '⏭️ Пропустить фото', callback_data: 'skip_step' }
                            ]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, 
                    `Номер: ${data.reg_number} ✅\n\n` +
                    '📸 Шаг 5/5: Загрузите фотографии вашего автомобиля!\n' +
                    'Вы можете отправить несколько фото подряд.', 
                    { 
                        parse_mode: 'Markdown',
                        ...carPhotosKeyboard 
                    }
                );
            }
            break;
            
        case 'photos':
            if (msg.text) {
                // Пользователь отправил текст вместо фото - даем подсказку
                // /done и /skip теперь обрабатываются через callback_data
                const carPhotosKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Закончить', callback_data: 'finish_photos' },
                                { text: '⏭️ Пропустить фото', callback_data: 'skip_step' }
                            ]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, 
                    '📸 Ожидается фотография автомобиля.\n\n' +
                    'Отправьте фото или используйте кнопки ниже:', 
                    carPhotosKeyboard
                );
            }
            // Если это фото, оно обрабатывается в handleCarPhoto
            break;
    }
}

// Завершение добавления автомобиля
async function completeAddCar(msg, userId, data) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Сначала зарегистрируйтесь командой /register');
            userStates.delete(userId);
            return;
        }
        
        // Определяем статус автомобиля в зависимости от статуса пользователя
        let carStatus = 'активный'; // По умолчанию для активных пользователей
        
        if (member.status === 'участник' || member.status === 'без авто') {
            carStatus = 'на модерации'; // Требует одобрения админа
        } else if (member.status === 'активный') {
            carStatus = 'активный'; // Сразу активный
        }
        
        const carData = {
            member_id: member.id,
            brand: data.brand,
            model: data.model,
            year: data.year,
            reg_number: data.reg_number || null,
            photos: data.photos ? JSON.stringify(data.photos) : null,
            status: carStatus
        };
        
        const newCar = await db.createCar(carData);
        
        // Проверяем и обновляем статус приглашений с таким же номером
        if (newCar && data.reg_number) {
            await checkAndUpdateInvitationStatus(data.reg_number, newCar.id);
        }
        
        // Проверяем, удалось ли сохранить автомобиль
        if (!newCar) {
            console.error('❌ Не удалось сохранить данные автомобиля в БД');
            userStates.delete(userId);
            
            bot.sendMessage(msg.chat.id, 
                '❌ Ошибка сохранения автомобиля\n\n' +
                '🔧 База данных временно недоступна.\n' +
                'Данные автомобиля не были сохранены.\n\n' +
                '🔄 Пожалуйста, попробуйте добавить автомобиль позже\n\n' +
                '📞 Если проблема повторится, обратитесь к администратору.',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        userStates.delete(userId);
        
        let confirmText = `🎉 Автомобиль добавлен успешно!\n\n` +
            `🚗 ${data.brand} ${data.model}\n` +
            `📅 Год: ${data.year}\n`;
        
        if (data.reg_number) {
            confirmText += `🔢 Номер: ${data.reg_number}\n`;
        }
        
        confirmText += `📊 Статус: ${carStatus}\n`;
        
        // Добавляем пояснение для статуса "на модерации"
        if (carStatus === 'на модерации') {
            confirmText += `\n⚠️ Автомобиль отправлен на модерацию администраторам.\n`;
            confirmText += `После одобрения статус изменится на "активный".`;
        }
        
        if (data.photos && data.photos.length > 0) {
            confirmText += `📸 Фотографий: ${data.photos.length}\n`;
        }
        
        confirmText += '\nТеперь вы можете добавить ещё автомобили или перейти в главное меню.';
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📋 Главное меню', callback_data: 'menu' },
                        { text: '🎯 Новое приглашение', callback_data: 'create_invitation' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, confirmText, { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
        
        console.log(`✅ Добавлен автомобиль: ${data.brand} ${data.model} для пользователя ${userId}`);
        
        // Проверяем изменение статуса на "участник" при добавлении автомобиля
        const statusResult = await db.checkAndUpdateCandidateStatus(userId);
        if (statusResult && statusResult.statusChanged) {
            const statusMember = statusResult.member;
            const statusMessage = 
                `🚗 Статус участника обновлён!\n\n` +
                `${statusMember.first_name} теперь **участник** клуба!\n\n` +
                `📊 Статус: ${statusMember.old_status} → ⚪ ${statusMember.new_status}\n` +
                `🚗 Автомобилей: ${statusMember.car_count}\n\n` +
                `🎯 Для получения статуса "активный" обратитесь к администратору.`;
            
            await sendGroupNotification(statusMessage, {}, 'system_messages');
        }
        
        // Проверяем, это ли первый автомобиль участника
        const memberCars = await db.getCarsByMemberId(member.id);
        const isFirstCar = memberCars.length === 1; // Только что добавленный автомобиль
        
        if (isFirstCar) {
            // Это первый автомобиль - отправляем полное приветствие нового члена клуба
            let welcomeMessage = `🎉 Новый член клуба!\n\n`;
            welcomeMessage += `👤 ${member.first_name}`;
            if (member.last_name) welcomeMessage += ` ${member.last_name}`;
            welcomeMessage += ``;
            if (member.nickname) welcomeMessage += ` (@${member.nickname})`;
            if (member.city) welcomeMessage += `\n🏙️ ${member.city}`;
            if (member.about) welcomeMessage += `\n\n💭 ${member.about}`;
            
            welcomeMessage += `\n\n🚗 ${data.brand} ${data.model}\n`;
            welcomeMessage += `📅 Год: ${data.year}`;
            if (data.reg_number) welcomeMessage += `\n🔢 Номер: ${data.reg_number}`;
            if (data.photos && data.photos.length > 0) {
                welcomeMessage += `\n📸 Фотографий: ${data.photos.length}`;
            }
            
            welcomeMessage += `\n\n🎊 Теперь вы полноправный участник клуба!`;
            
            // Отправляем фото автомобиля если есть
            if (data.photos && data.photos.length > 0) {
                const fs = require('fs');
                const path = require('path');
                const carPhotoPath = path.resolve(config.UPLOADS.carsPath, data.photos[0]);
                
                if (fs.existsSync(carPhotoPath)) {
                    await sendGroupPhoto(carPhotoPath, welcomeMessage, {}, 'new_member');
                } else {
                    console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
                    await sendGroupNotification(welcomeMessage, {}, 'new_member');
                }
            } else if (member.photo_url) {
                const fs = require('fs');
                const path = require('path');
                const memberPhotoPath = path.resolve(config.UPLOADS.membersPath, member.photo_url);
                
                if (fs.existsSync(memberPhotoPath)) {
                    await sendGroupPhoto(memberPhotoPath, welcomeMessage, {}, 'new_member');
                } else {
                    console.log('⚠️ Файл фото профиля не найден:', memberPhotoPath);
                    await sendGroupNotification(welcomeMessage, {}, 'new_member');
                }
            } else {
                await sendGroupNotification(welcomeMessage, {}, 'new_member');
            }
        } else {
            // Это дополнительный автомобиль
            let carMessage = `🚗 Новый автомобиль в клубе!\n\n`;
            carMessage += `👤 ${member.first_name}`;
            if (member.last_name) carMessage += ` ${member.last_name}`;
            if (member.nickname) carMessage += ` (@${member.nickname})`;
            
            carMessage += `\n\n🚗 ${data.brand} ${data.model}\n`;
            carMessage += `📅 Год: ${data.year}`;
            if (data.reg_number) carMessage += `\n🔢 Номер: ${data.reg_number}`;
            if (data.photos && data.photos.length > 0) {
                carMessage += `\n📸 Фотографий: ${data.photos.length}`;
            }
            
            carMessage += `\n\n📊 Автомобилей: ${memberCars.length}`;
            
            // Отправляем фото автомобиля если есть
            if (data.photos && data.photos.length > 0) {
                const fs = require('fs');
                const path = require('path');
                const carPhotoPath = path.resolve(config.UPLOADS.carsPath, data.photos[0]);
                
                if (fs.existsSync(carPhotoPath)) {
                    await sendGroupPhoto(carPhotoPath, carMessage, {}, 'new_car');
                } else {
                    console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
                    await sendGroupNotification(carMessage, {}, 'new_car');
                }
            } else {
                await sendGroupNotification(carMessage, {}, 'new_car');
            }
        }
        
    } catch (error) {
        console.error('Ошибка добавления автомобиля:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Ошибка при сохранении автомобиля. Попробуйте ещё раз.');
    }
}

// Обработка создания приглашения
async function handleCreateInvitation(msg, userId, userState) {
    const step = userState.step;
    const data = userState.data || {};
    
    switch (step) {
        case 'reg_number':
            // Валидация номера (обязательное поле)
            const validation = validateRegNumber(msg.text);
            
            if (!validation.valid) {
                bot.sendMessage(msg.chat.id, 
                    `❌ ${validation.error}\n\n` +
                    'Примеры правильных номеров:\n' +
                    '• A123BC77\n' +
                    '• 1234AB199\n' +
                    '• H001AA\n\n' +
                    '⚠️ Номер обязателен! Попробуйте ещё раз:',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            data.reg_number = validation.number;
            
            // Проверяем, есть ли уже такой номер в базе
            try {
                const existingCars = await db.getCarsByRegNumber(validation.number);
                
                if (existingCars.length > 0) {
                    const car = existingCars[0];
                    
                    // Если это автомобиль участника клуба
                    if (car.member_id && car.status !== 'приглашение') {
                        const owner = await db.getMemberById(car.member_id);
                        
                        let memberCarText = `🚫 Этот автомобиль принадлежит участнику клуба!\n\n`;
                        memberCarText += `🔢  ${validation.number}\n`;
                        memberCarText += `🚗  ${car.brand} ${car.model}`;
                        if (car.year) memberCarText += ` (${car.year})`;
                        memberCarText += `\n📊 ${car.status}\n`;
                        
                        if (owner) {
                            memberCarText += `👤 ${owner.first_name}`;
                            if (owner.last_name) memberCarText += ` ${owner.last_name}`;
                            if (owner.nickname) memberCarText += ` (@${owner.nickname})`;
                            memberCarText += `\n`;
                        }
                        
                        if (car.photos) {
                            try {
                                const photos = JSON.parse(car.photos);
                                if (photos && photos.length > 0) {
                                    memberCarText += `📸 Фотографий: ${photos.length}\n`;
                                }
                            } catch (error) {
                                console.error('Ошибка парсинга фото:', error);
                            }
                        }
                        
                        memberCarText += '\n💡 Совет: Свяжитесь с владельцем через клуб или администратора.';
                        
                        userStates.delete(userId);
                        bot.sendMessage(msg.chat.id, memberCarText, { 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📋 Главное меню', callback_data: 'menu' },
                                        { text: '🎯 Новое приглашение', callback_data: 'create_invitation' }
                                    ]
                                ]
                            }
                        });
                        return;
                    }
                    
                    // Если это автомобиль для приглашений (дубликат)
                    if (car.status === 'приглашение') {
                        const invitations = await db.getInvitationsByCar(car.id);
                        
                        let duplicateText = `⚠️ Автомобиль с номером ${validation.number} уже есть в приглашениях!\n\n`;
                        duplicateText += `🚗  ${car.brand}\n`;
                        duplicateText += `🚗  ${car.model}\n`;
                        duplicateText += `📮  ${invitations.length}\n`;
                        
                        if (invitations.length > 0) {
                            const lastInvitation = invitations[0];
                            duplicateText += `📅 ${formatDate(lastInvitation.invitation_date)}\n`;
                            duplicateText += `📍  ${lastInvitation.location}\n`;
                        }
                        
                        if (car.photos) {
                            try {
                                const photos = JSON.parse(car.photos);
                                if (photos && photos.length > 0) {
                                    duplicateText += `📸 ${photos.length}\n`;
                                }
                            } catch (error) {
                                console.error('Ошибка парсинга фото:', error);
                            }
                        }
                        
                        duplicateText += '\n🤔 Хотите всё равно создать новое приглашение?';
                        
                        userState.data = data;
                        userState.step = 'confirm_duplicate';
                        userStates.set(userId, userState);
                        
                        const duplicateKeyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '✅ Продолжить', callback_data: 'continue_invitation' },
                                        { text: '❌ Отменить', callback_data: 'cancel_invitation' }
                                    ]
                                ]
                            }
                        };
                        
                        bot.sendMessage(msg.chat.id, duplicateText, { 
                            parse_mode: 'Markdown',
                            ...duplicateKeyboard 
                        });
                        return;
                    }
                }
            } catch (error) {
                console.error('Ошибка проверки дубликатов:', error);
            }
            
            // Если дубликатов нет, продолжаем
            userState.data = data;
            userState.step = 'photos';
            userStates.set(userId, userState);
            
            const invitationPhotosKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Закончить фото', callback_data: 'finish_photos' },
                            { text: '⏭️ Пропустить фото', callback_data: 'skip_step' }
                        ]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                `🔢 Номер: ${data.reg_number} ✅\n\n` +
                '📸 Сфотографируйте автомобиль\n' +
                'Это поможет лучше идентифицировать автомобиль при повторной встрече.\n\n' +
                '• Отправьте одну или несколько фотографий',
                { 
                    parse_mode: 'Markdown',
                    ...invitationPhotosKeyboard 
                }
            );
            break;
            
        case 'confirm_duplicate':
            // Этот случай теперь обрабатывается через callback_data в обработчике callback_query
            // Текстовые сообщения игнорируются
            bot.sendMessage(msg.chat.id, 
                '🤔 Пожалуйста, используйте кнопки выше для выбора действия.'
            );
            break;
            
        case 'location':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            // Сохраняем место (пропуск теперь обрабатывается через callback_data)
            data.location = msg.text.trim();
            
            userState.data = data;
            userState.step = 'brand';
            userStates.set(userId, userState);
            
            let locationText = '';
            if (data.location) {
                locationText += `📍 Место: ${data.location} ✅\n\n`;
            }
            locationText += '🚗 Марка автомобиля (необязательно)\n';
            locationText += 'Если знаете марку, введите её:\n';
            locationText += 'Например: BMW, Mercedes-Benz, Audi, Porsche\n\n';
            const locationKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⏭️ Пропустить', callback_data: 'skip_step' },
                            { text: '✅ Завершить', callback_data: 'finish_invitation' }
                        ]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, locationText, { 
                parse_mode: 'Markdown',
                ...locationKeyboard 
            });
            break;
            
        case 'photos':
            if (msg.text && (msg.text.trim() === '/done')) {
                // Завершаем загрузку фото и переходим к следующему этапу
                const photoCount = data.photos ? data.photos.length : 0;
                
                if (photoCount === 0) {
                    const invitationPhotosKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Закончить фото', callback_data: 'finish_photos' },
                                    { text: '⏭️ Пропустить фото', callback_data: 'skip_step' }
                                ]
                            ]
                        }
                    };
                    
                    bot.sendMessage(msg.chat.id, 
                        '📸 Вы не загрузили ни одного фото.\n' +
                        'Отправьте фотографию или используйте кнопки ниже:',
                        invitationPhotosKeyboard
                    );
                    return;
                }
                
                userState.step = 'location';
                userStates.set(userId, userState);
                
                const locationKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '⏭️ Пропустить', callback_data: 'skip_step' },
                                { text: '✅ Завершить', callback_data: 'finish_invitation' }
                            ]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, 
                    `📸 Загружено фотографий: ${photoCount} ✅\n\n` +
                    '📍 Где вы оставили визитку? (необязательно)\n' +
                    'Например: "Парковка ТЦ Галерея", "ул. Ленина 15", "возле дома"\n\n' +
                    '• Введите место',
                    { 
                        parse_mode: 'Markdown',
                        ...locationKeyboard 
                    }
                );
            } else if (msg.text) {
                // Игнорируем текстовые сообщения на этапе фото (включая "undefined")
                // Пользователь должен использовать кнопки или отправлять фото
                console.log(`⚠️ Игнорируем текстовое сообщение на этапе фото: "${msg.text}"`);
                return;
            }
            break;
            
        case 'brand':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            // Сохраняем марку (пропуск теперь обрабатывается через callback_data)
            data.brand = msg.text.trim();
            userState.data = data;
            userState.step = 'model';
            userStates.set(userId, userState);
            
            let brandText = '';
            if (data.brand) {
                brandText += `🚗 Марка: ${data.brand} ✅\n\n`;
            }
            brandText += '🚗 Модель автомобиля (необязательно)\n';
            brandText += 'Если знаете модель, введите её:\n';
            brandText += 'Например: E46, SLK, A4, 911\n\n';
            const brandKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⏭️ Пропустить', callback_data: 'skip_step' },
                            { text: '✅ Завершить', callback_data: 'finish_invitation' }
                        ]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, brandText, { 
                parse_mode: 'Markdown',
                ...brandKeyboard 
            });
            break;
            
        case 'model':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            // Сохраняем модель (пропуск теперь обрабатывается через callback_data)
            data.model = msg.text.trim();
            userState.data = data;
            userState.step = 'contact_info';
            userStates.set(userId, userState);
            
            let modelText = '';
            if (data.model) {
                modelText += `🚗 Модель: ${data.model} ✅\n\n`;
            }
            modelText += '📱 Контакты в визитке (необязательно)\n';
            modelText += 'Какие контакты вы оставили?\n';
            modelText += 'Например: "Telegram @username", "+7 999 123-45-67", "Иван Петров"\n\n';
            const modelKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⏭️ Пропустить', callback_data: 'skip_step' },
                            { text: '✅ Завершить', callback_data: 'finish_invitation' }
                        ]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, modelText, { 
                parse_mode: 'Markdown',
                ...modelKeyboard 
            });
            break;
            
        case 'contact_info':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            // Сохраняем контакты (пропуск теперь обрабатывается через callback_data)
            data.contact_info = msg.text.trim();
            userState.data = data;
            userState.step = 'notes';
            userStates.set(userId, userState);
            
            let contactText = '';
            if (data.contact_info) {
                contactText += `📱 Контакты: ${data.contact_info} ✅\n\n`;
            }
            contactText += '📝 Дополнительные заметки (необязательно)\n';
            contactText += 'Например: "красивый кабриолет", "стоял долго", "владелец рядом был"\n\n';
            const contactKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⏭️ Пропустить', callback_data: 'skip_step' },
                            { text: '✅ Завершить', callback_data: 'finish_invitation' }
                        ]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, contactText, { 
                parse_mode: 'Markdown',
                ...contactKeyboard 
            });
            break;
            
        case 'notes':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            // Сохраняем заметки (пропуск теперь обрабатывается через callback_data)
            data.notes = msg.text.trim();
            
            // Завершаем создание приглашения
            await completeCreateInvitation(msg, userId, data);
            break;
    }
}

// Функция валидации регистрационного номера
function validateRegNumber(regNumber) {
    console.log('🔍 DEBUG validateRegNumber called with:', regNumber);
    console.log('🔍 DEBUG validateRegNumber stack:', new Error().stack.split('\n').slice(1, 4));
    
    if (!regNumber || typeof regNumber !== 'string') {
        console.log('🔍 DEBUG validateRegNumber returning: номер не указан');
        return { valid: false, error: 'Номер не указан' };
    }
    
    const cleanNumber = regNumber.trim().toUpperCase();
    
    // Проверка на пустоту
    if (cleanNumber.length === 0) {
        return { valid: false, error: 'Номер не может быть пустым' };
    }
    
    // Проверка длины
    if (cleanNumber.length < 4 || cleanNumber.length > 12) {
        return { valid: false, error: 'Номер должен содержать от 4 до 12 символов' };
    }
    
    // Проверка формата (только латинские буквы и цифры)
    const regNumberPattern = /^[A-Z0-9]+$/;
    if (!regNumberPattern.test(cleanNumber)) {
        return { 
            valid: false, 
            error: 'Используйте только латинские буквы (A-Z) и цифры (0-9) без пробелов и символов' 
        };
    }
    
    return { valid: true, number: cleanNumber };
}

// Завершение создания приглашения
async function completeCreateInvitation(msg, userId, data) {
    try {
        console.log('🔍 Отладка completeCreateInvitation:');
        console.log('userId:', userId);
        console.log('data:', JSON.stringify(data, null, 2));
        
        // Сначала создаем или находим автомобиль
        let car = null;
        
        // Ищем существующий автомобиль по номеру (если указан)
        if (data.reg_number) {
            const existingCars = await db.getCarsByRegNumber(data.reg_number);
            if (existingCars.length > 0) {
                car = existingCars[0];
                console.log('Найден существующий автомобиль:', car.id);
            }
        }
        
        // Если автомобиль не найден, создаем новый (без владельца)
        if (!car) {
            const carData = {
                member_id: null, // Автомобиль без владельца
                brand: data.brand || 'Неизвестно',
                model: data.model || 'Неизвестно',
                year: data.year || 1900, // Год по умолчанию если не указан
                reg_number: data.reg_number,
                status: 'приглашение',
                photos: data.photos && data.photos.length > 0 ? JSON.stringify(data.photos) : null
            };
            
            car = await db.createCar(carData);
            
            // Проверяем, удалось ли создать автомобиль
            if (!car) {
                console.error('❌ Не удалось создать автомобиль для приглашения');
                userStates.delete(userId);
                
                bot.sendMessage(msg.chat.id, 
                    '❌ Ошибка сохранения данных\n\n' +
                    '🔧 База данных временно недоступна.\n' +
                    'Приглашение не было сохранено.\n\n' +
                    '🔄 Пожалуйста, попробуйте создать приглашение позже\n\n' +
                    '📞 Если проблема повторится, обратитесь к администратору.',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            console.log('Создан новый автомобиль для приглашения:', car.id);
            console.log(`🔢 Номер: ${data.reg_number}`);
            console.log(`🚗 Марка/Модель: ${carData.brand}/${carData.model}`);
            if (data.photos && data.photos.length > 0) {
                console.log(`📸 Добавлено ${data.photos.length} фото для автомобиля`);
            }
        }
        
        // Создаем приглашение
        const invitationData = {
            car_id: car.id,
            invitation_date: new Date().toISOString().split('T')[0], // Сегодняшняя дата
            location: data.location || 'Не указано',
            inviter_member_id: data.inviter_member_id,
            status: 'новое',
            contact_phone: null, // Пока не используем
            contact_name: data.contact_info || null,
            notes: data.notes || null
        };
        
        const invitation = await db.createInvitation(invitationData);
        
        // Проверяем, удалось ли создать приглашение
        if (!invitation) {
            console.error('❌ Не удалось создать приглашение');
            userStates.delete(userId);
            
            bot.sendMessage(msg.chat.id, 
                '❌ Ошибка сохранения приглашения\n\n' +
                '🔧 База данных временно недоступна.\n' +
                'Приглашение не было сохранено.\n\n' +
                '🔄 Пожалуйста, попробуйте создать приглашение позже\n\n' +
                '📞 Если проблема повторится, обратитесь к администратору.',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Удаляем состояние пользователя
        userStates.delete(userId);
        
        // Отправляем подтверждение
        let confirmText = '🎉 Приглашение зафиксировано!\n\n';
        confirmText += `🔢 Номер: ${data.reg_number}\n`;
        confirmText += `📅 Дата: ${formatDate(invitationData.invitation_date)}\n`;
        
        if (data.location) {
            confirmText += `📍 Место: ${data.location}\n`;
        }
        if (data.photos && data.photos.length > 0) {
            confirmText += `📸 Фото: ${data.photos.length}\n`;
        }
        if (data.brand && data.brand !== 'Неизвестно') {
            confirmText += `🚗 Марка: ${data.brand}\n`;
        }
        if (data.model && data.model !== 'Неизвестно') {
            confirmText += `🚗 Модель: ${data.model}\n`;
        }
        if (data.contact_info) {
            confirmText += `📱 Контакт: ${data.contact_info}\n`;
        }
        if (data.notes) {
            confirmText += `📝 Заметки: ${data.notes}\n`;
        }
        
        confirmText += '\n✨ Отличная работа! Возможно, скоро у нас будет новый участник клуба!';
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📋 Главное меню', callback_data: 'menu' },
                        { text: '🎯 Ещё приглашение', callback_data: 'create_invitation' }
                    ],
                    [
                        { text: '📮 Мои приглашения', callback_data: 'my_invitations' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, confirmText, { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
        
        console.log(`✅ Создано приглашение: ${data.brand} ${data.model} (ID: ${invitation.id})`);
        
        // Отправляем уведомление в группу о новом приглашении
        const inviter = await db.getMemberById(data.inviter_member_id);
        
        let invitationMessage = `🎯 Новое приглашение!\n\n`;
        invitationMessage += `👤 ${inviter.first_name}`;
        if (inviter.last_name) invitationMessage += ` ${inviter.last_name}`;
        if (inviter.nickname) invitationMessage += ` (@${inviter.nickname})`;
        
        invitationMessage += `\n\n🚗 Автомобиль:\n`;
        invitationMessage += `🔢 Номер: ${data.reg_number}`;
        
        if (data.brand && data.brand !== 'Неизвестно') {
            invitationMessage += `\n🚗 Марка: ${data.brand}`;
        }
        if (data.model && data.model !== 'Неизвестно') {
            invitationMessage += ` ${data.model}`;
        }
        
        invitationMessage += `\n📅 Дата: ${formatDate(invitationData.invitation_date)}`;
        
        if (data.location && data.location !== 'Не указано') {
            invitationMessage += `\n📍 Место: ${data.location}`;
        }
        
        if (data.contact_info) {
            invitationMessage += `\n📱 Контакт: ${data.contact_info}`;
        }
        
        if (data.notes) {
            invitationMessage += `\n📝 Заметки: ${data.notes}`;
        }
        
        if (data.photos && data.photos.length > 0) {
            invitationMessage += `\n📸 Фото: ${data.photos.length}`;
        }
        
        invitationMessage += `\n\n🤞 Надеемся на отклик владельца!`;
        
        // Отправляем фото автомобиля если есть
        if (data.photos && data.photos.length > 0) {
            const fs = require('fs');
            const path = require('path');
            const carPhotoPath = path.resolve(config.UPLOADS.carsPath, data.photos[0]);
            
            if (fs.existsSync(carPhotoPath)) {
                await sendGroupPhoto(carPhotoPath, invitationMessage, {}, 'new_invitation');
            } else {
                console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
                await sendGroupNotification(invitationMessage, {}, 'new_invitation');
            }
        } else {
            await sendGroupNotification(invitationMessage, {}, 'new_invitation');
        }
        
    } catch (error) {
        console.error('Ошибка создания приглашения:', error);
        userStates.delete(userId);
        
        bot.sendMessage(msg.chat.id, 
            '❌ Произошла ошибка при сохранении приглашения.\n' +
            'Пожалуйста, попробуйте ещё раз.\n\n' +
            'Если проблема повторится, обратитесь к администратору.'
        );
    }
}

// Функция загрузки и сохранения фотографии
async function downloadPhoto(fileId, fileName) {
    try {
        console.log('📸 Начинаем загрузку фото участника:');
        console.log('   File ID:', fileId);
        console.log('   File Name:', fileName);
        
        // Получаем информацию о файле
        const file = await bot.getFile(fileId);
        console.log('   Telegram File Info:', file);
        
        const fileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
        console.log('   Download URL:', fileUrl);
        
        // Создаём директории если их нет
        createUploadDirs();
        
        // Определяем путь для сохранения
        const filePath = path.resolve(config.UPLOADS.membersPath, fileName);
        console.log('   Save Path:', filePath);
        console.log('   Members Path Config:', config.UPLOADS.membersPath);
        
        // Загружаем файл
        console.log('   Загружаем файл с URL...');
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log('   Размер файла:', buffer.length, 'байт');
        
        // Сохраняем файл
        fs.writeFileSync(filePath, buffer);
        console.log('   ✅ Файл сохранен успешно');
        
        // Возвращаем относительный путь
        const relativePath = `uploads/members/${fileName}`;
        console.log('   Возвращаем путь:', relativePath);
        return relativePath;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки фото участника:');
        console.error('   File ID:', fileId);
        console.error('   File Name:', fileName);
        console.error('   Error:', error);
        throw error;
    }
}

// Функция загрузки фото автомобиля
async function downloadCarPhoto(fileId, fileName) {
    try {
        console.log('🚗 Начинаем загрузку фото автомобиля:');
        console.log('   File ID:', fileId);
        console.log('   File Name:', fileName);
        
        const file = await bot.getFile(fileId);
        console.log('   Telegram File Info:', file);
        
        const fileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
        console.log('   Download URL:', fileUrl);
        
        createUploadDirs();
        const filePath = path.resolve(config.UPLOADS.carsPath, fileName);
        console.log('   Save Path:', filePath);
        console.log('   Cars Path Config:', config.UPLOADS.carsPath);
        
        console.log('   Загружаем файл с URL...');
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log('   Размер файла:', buffer.length, 'байт');
        
        fs.writeFileSync(filePath, buffer);
        console.log('   ✅ Файл сохранен успешно');
        
        console.log('   ✅ Файл сохранен успешно');
        return { success: true, fileName: fileName };
        
    } catch (error) {
        console.error('❌ Ошибка загрузки фото автомобиля:');
        console.error('   File ID:', fileId);
        console.error('   File Name:', fileName);
        console.error('   Error:', error);
        throw error;
    }
}

// Обработка фото во время регистрации
async function handlePhotoRegistration(msg, userId, userState) {
    try {
        // Получаем самое большое фото
        const photo = msg.photo[msg.photo.length - 1];
        const fileName = `member_${userId}_${Date.now()}.jpg`;
        
        // Загружаем фото
        const photoPath = await downloadPhoto(photo.file_id, fileName);
        
        // Сохраняем только имя файла в данных пользователя (не полный путь)
        const data = userState.data || {};
        data.photo_url = fileName;
        
        // Проверяем, что у нас есть обязательные данные
        if (!data.first_name) {
            bot.sendMessage(msg.chat.id, 
                '❌ Ошибка: не найдено имя пользователя.\n' +
                'Пожалуйста, начните регистрацию заново командой /register'
            );
            userStates.delete(userId);
            return;
        }
        
        bot.sendMessage(msg.chat.id, 
            '✅ Фотография загружена успешно!\n\n' +
            'Завершаем регистрацию...'
        );
        
        // Завершаем регистрацию
        await completeRegistration(msg, userId, data);
        
    } catch (error) {
        console.error('Ошибка обработки фото регистрации:', error);
        bot.sendMessage(msg.chat.id, 
            '❌ Ошибка при загрузке фотографии.\n' +
            'Попробуйте ещё раз или нажмите /skip'
        );
    }
}

// Обработка фото автомобиля
async function handleCarPhoto(msg, userId, userState) {
    try {
        const photo = msg.photo[msg.photo.length - 1];
        const data = userState.data || {};
        
        // Инициализируем массив фото если его нет
        if (!data.photos) {
            data.photos = [];
        }
        
        const fileName = `car_${userId}_${Date.now()}_${data.photos.length + 1}.jpg`;
        const photoPath = await downloadCarPhoto(photo.file_id, fileName);
        
        // Добавляем только имя файла в массив
        data.photos.push(fileName);
        userState.data = data;
        userStates.set(userId, userState);
        
        const carPhotosKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Закончить', callback_data: 'finish_photos' },
                        { text: '📸 Ещё фото', callback_data: 'continue_photos' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            `✅ Фото ${data.photos.length} загружено!\n\n` +
            'Можете отправить ещё фотографии или закончить:', 
            carPhotosKeyboard
        );
        
    } catch (error) {
        console.error('Ошибка обработки фото автомобиля:', error);
        bot.sendMessage(msg.chat.id, 
            '❌ Ошибка при загрузке фотографии.\n' +
            'Попробуйте ещё раз или нажмите /done для завершения.'
        );
    }
}

// Обработка фото приглашенного автомобиля
async function handleInvitationPhoto(msg, userId, userState) {
    try {
        // Проверяем, что мы на этапе фото
        if (userState.step !== 'photos') {
            bot.sendMessage(msg.chat.id, 
                '📸 Сейчас не время для фотографий. Следуйте инструкциям.'
            );
            return;
        }
        
        const photo = msg.photo[msg.photo.length - 1];
        const data = userState.data || {};
        
        // Инициализируем массив фото если его нет
        if (!data.photos) {
            data.photos = [];
        }
        
        const fileName = `invitation_${userId}_${Date.now()}_${data.photos.length + 1}.jpg`;
        const photoPath = await downloadCarPhoto(photo.file_id, fileName);
        
        // Добавляем только имя файла в массив
        data.photos.push(fileName);
        userState.data = data;
        userStates.set(userId, userState);
        
        const invitationPhotosKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Закончить', callback_data: 'finish_photos' },
                        { text: '📸 Ещё фото', callback_data: 'continue_photos' }
                    ]
                ]
            }
        };
        
        let photoText = `✅ Фото ${data.photos.length} загружено!\n\n`;
        photoText += `🔢 Номер: ${data.reg_number}\n`;
        photoText += 'Можете отправить ещё фотографии или закончить:';
        
        bot.sendMessage(msg.chat.id, photoText, invitationPhotosKeyboard);
        
    } catch (error) {
        console.error('Ошибка обработки фото приглашения:', error);
        bot.sendMessage(msg.chat.id, 
            '❌ Ошибка при загрузке фотографии.\n' +
            'Попробуйте ещё раз или нажмите /done для завершения.'
        );
    }
}

// Функция начала поиска по номеру
async function startSearchByNumber(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            const notRegisteredSearchKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🔍 Для поиска автомобилей необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:',
                { 
                    parse_mode: 'Markdown',
                    ...notRegisteredSearchKeyboard 
                }
            );
            return;
        }
        
        userStates.set(userId, { 
            state: 'searching', 
            step: 'number'
        });
        
        const searchKeyboard = addBackToMenuButton({});
        bot.sendMessage(msg.chat.id, 
            '🔍 Поиск автомобилей по номеру\n\n' +
            'Введите регистрационный номер или его часть:\n' +
            '• Полный номер: A123BC77\n' +
            '• Частичный поиск: A123, BC77, 123\n\n' +
            'Поиск не чувствителен к регистру.',
            { 
                parse_mode: 'Markdown',
                ...searchKeyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка начала поиска:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка. Попробуйте позже.');
    }
}

// Обработка поиска по номеру
async function handleSearch(msg, userId, userState) {
    try {
        const searchQuery = msg.text.trim().toUpperCase();
        
        if (searchQuery.length < 2) {
            bot.sendMessage(msg.chat.id, 
                '❌ Введите минимум 2 символа для поиска.\n' +
                'Попробуйте ещё раз:'
            );
            return;
        }
        
        // Ищем автомобили по частичному совпадению
        const cars = await db.searchCarsByRegNumber(searchQuery);
        
        userStates.delete(userId);
        
        if (cars.length === 0) {
            bot.sendMessage(msg.chat.id, 
                `🔍 По запросу "${searchQuery}" ничего не найдено.\n\n` +
                'Попробуйте другой номер или его часть.',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔍 Новый поиск', callback_data: 'search_by_number' },
                                { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        let resultsText = `🔍 Результаты поиска по "${searchQuery}"\n\n`;
        resultsText += `Найдено автомобилей: ${cars.length}\n\n`;
        
        for (let i = 0; i < cars.length; i++) {
            const car = cars[i];
            resultsText += `${i + 1}. ${car.brand} ${car.model}`;
            if (car.year) resultsText += ` (${car.year})`;
            resultsText += `\n🔢 Номер: ${car.reg_number || 'не указан'}`;
            resultsText += `\n📊 Статус: ${car.status}`;
            
            // Показываем информацию о фотографиях
            if (car.photos) {
                try {
                    const photos = JSON.parse(car.photos);
                    if (photos && photos.length > 0) {
                        resultsText += `\n📸 Фотографий: ${photos.length}`;
                    }
                } catch (error) {
                    console.error('Ошибка парсинга фото:', error);
                }
            }
            
            // Если это автомобиль для приглашений, показываем количество приглашений
            if (car.status === 'приглашение') {
                try {
                    const invitations = await db.getInvitationsByCar(car.id);
                    resultsText += `\n📮 Приглашений: ${invitations.length}`;
                    if (invitations.length > 0) {
                        const lastInvitation = invitations[0]; // Последнее приглашение
                        resultsText += `\n📅 Последнее: ${formatDate(lastInvitation.invitation_date)}`;
                        resultsText += `\n📍 Место: ${lastInvitation.location}`;
                    }
                } catch (error) {
                    console.error('Ошибка получения приглашений для авто:', error);
                }
            }
            
            resultsText += `\n\n`;
        }
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔍 Новый поиск', callback_data: 'search_by_number' },
                        { text: '🎯 Новое приглашение', callback_data: 'create_invitation' }
                    ],
                    [
                        { text: '🔙 Назад в меню', callback_data: 'back_to_menu' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, resultsText, { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
        
    } catch (error) {
        console.error('Ошибка поиска:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Ошибка поиска. Попробуйте ещё раз.');
    }
}

// Обработка изменения статуса пользователя
async function handleSetUserStatus(msg, userId, userState) {
    if (userState.step !== 'enter_username') {
        return;
    }
    
    try {
        const username = msg.text.trim();
        const selectedStatus = userState.data.selectedStatus;
        
        if (!username) {
            bot.sendMessage(msg.chat.id, 
                '❌ Введите корректный username.\n' +
                'Попробуйте ещё раз или используйте /cancel для отмены.'
            );
            return;
        }
        
        // Ищем пользователя по username
        const member = await db.getMemberByUsername(username);
        
        if (!member) {
            const notFoundKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Отменить', callback_data: 'cancel_status_change' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                `❌ Пользователь с username "${username}" не найден\n\n` +
                `🔍 Возможные причины:\n` +
                `• Пользователь не зарегистрирован в клубе\n` +
                `• Неправильно указан username\n` +
                `• Пользователь сменил username\n\n` +
                `💡 Попробуйте:\n` +
                `• Проверить правильность написания\n` +
                `• Убедиться что пользователь есть в группе\n` +
                `• Попросить пользователя сообщить актуальный username\n\n` +
                `Введите другой username или отмените операцию:`,
                { 
                    parse_mode: 'Markdown',
                    ...notFoundKeyboard 
                }
            );
            return;
        }
        
        // Подтверждение изменения статуса
        const statusIcon = selectedStatus === 'активный' ? '✅' : 
                         selectedStatus === 'новый' ? '🆕' : 
                         selectedStatus === 'без авто' ? '⚪' : '🚫';
        
        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Подтвердить', callback_data: 'confirm_status_change' },
                        { text: '❌ Отменить', callback_data: 'cancel_status_change' }
                    ]
                ]
            }
        };
        
        // Сохраняем найденного пользователя для подтверждения
        userState.data.targetMember = member;
        userState.step = 'confirm';
        userStates.set(userId, userState);
        
        let confirmText = `🔧 Подтверждение изменения статуса\n\n`;
        confirmText += `👤 **Пользователь:** ${member.first_name}`;
        if (member.last_name) confirmText += ` ${member.last_name}`;
        confirmText += `\n📱 **Username:** @${member.nickname}`;
        confirmText += `\n📊 **Текущий статус:** ${member.status}`;
        confirmText += `\n🔄 **Новый статус:** ${statusIcon} ${selectedStatus}`;
        
        if (member.status === selectedStatus) {
            confirmText += `\n\n⚠️ **Внимание:** Пользователь уже имеет статус "${selectedStatus}"`;
        }
        
        confirmText += `\n\n❓ Подтвердить изменение статуса?`;
        
        bot.sendMessage(msg.chat.id, confirmText, { 
            parse_mode: 'Markdown',
            ...confirmKeyboard 
        });
        
    } catch (error) {
        console.error('Ошибка обработки изменения статуса:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка. Попробуйте ещё раз.');
    }
}

// Обработка установки пароля администратором
async function handlePasswordSetting(msg, userId, userState) {
    const password = msg.text.trim();
    
    // Проверяем длину пароля
    if (password.length < 5) {
        bot.sendMessage(msg.chat.id, 
            '❌ Пароль слишком короткий\n\n' +
            '⚡ Минимальная длина пароля: 5 символов\n' +
            '✏️ Введите новый пароль:',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Устанавливаем пароль
    setActivePassword(password);
    
    // Очищаем состояние пользователя
    userStates.delete(userId);
    
    // Подтверждение для администратора
    const successKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔒 Админ панель', callback_data: 'category_admin' }],
                [{ text: '📋 Главное меню', callback_data: 'menu' }]
            ]
        }
    };
    
    bot.sendMessage(msg.chat.id, 
        '✅ Пароль установлен успешно!\n\n' +
        `🔐 Пароль: \`${password}\`\n` +
        '⏰ Время жизни: 10 минут\n' +
        '👥 Доступен для участников со статусом "участник" и "без авто"\n\n' +
        '📢 Теперь участники встречи могут получить активный статус:\n' +
        '👤 Личный кабинет → Мой профиль → 🎯 Получить активный статус\n\n' +
        '🗑️ Пароль автоматически удалится через 10 минут.',
        { 
            parse_mode: 'Markdown',
            ...successKeyboard 
        }
    );
    
    console.log(`🔐 Администратор ${userId} установил пароль: ${password}`);
}

// Обработка ввода пароля пользователем
async function handlePasswordEntering(msg, userId, userState) {
    const inputPassword = msg.text.trim();
    const { telegramId, memberId, currentStatus } = userState.data;
    
    // Проверяем пароль
    if (!checkPassword(inputPassword)) {
        bot.sendMessage(msg.chat.id, 
            '❌ Неверный пароль\n\n' +
            '🔐 Введённый пароль не совпадает с установленным администратором.\n\n' +
            '💡 Убедитесь что:\n' +
            '• Пароль введён без ошибок\n' +
            '• Пароль ещё не истёк (10 минут)\n' +
            '• Вы получили пароль от администратора на встрече\n\n' +
            '✏️ Попробуйте ещё раз или обратитесь к администратору:',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    try {
        // Обновляем статус пользователя на "активный"
        const result = await db.updateMemberStatus(telegramId, 'активный');
        
        if (!result.success) {
            // Очищаем состояние в любом случае
            userStates.delete(userId);
            
            bot.sendMessage(msg.chat.id, 
                `❌ Ошибка обновления статуса\n\n` +
                `🔧 ${result.message || 'Неизвестная ошибка'}\n` +
                `Пароль был правильным, но статус не удалось обновить.\n\n` +
                `📞 Обратитесь к администратору для ручного изменения статуса.`,
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Очищаем состояние пользователя
        userStates.delete(userId);
        
        // Логируем изменение статуса
        console.log(`🎯 Пользователь ${userId} получил активный статус через пароль (было: ${currentStatus})`);
        
        // Получаем обновлённые данные пользователя для логирования
        const updatedMember = await db.getMemberByTelegramId(userId);
        if (updatedMember) {
            // Логируем в БД (если есть такая функция)
            try {
                await db.logAuthAttempt({
                    telegram_id: userId,
                    username: updatedMember.nickname,
                    first_name: updatedMember.first_name,
                    last_name: updatedMember.last_name,
                    is_member: true,
                    member_id: updatedMember.id,
                    status: 'success',
                    notes: `Status upgraded from ${currentStatus} to активный via password`
                });
            } catch (logError) {
                console.error('Ошибка логирования изменения статуса:', logError);
            }
        }
        
        // Успешное сообщение пользователю
        const successKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🌐 Веб-дашборд', callback_data: 'web_dashboard' }],
                    [{ text: '👤 Мой профиль', callback_data: 'my_profile' }],
                    [{ text: '📋 Главное меню', callback_data: 'menu' }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            '🎉 Поздравляем! Статус обновлён!\n\n' +
            '✅ Ваш новый статус: **активный**\n\n' +
            '🎯 Теперь вам доступны дополнительные возможности:\n' +
            '• 🌐 **Веб-дашборд** - расширенная статистика\n' +
            '• 📊 Полный доступ ко всем функциям бота\n' +
            '• 🚗 Участие в эксклюзивных активностях клуба\n\n' +
            '🙏 Спасибо за активное участие в жизни клуба!\n' +
            '💬 Продолжайте участвовать во встречах и мероприятиях.',
            { 
                parse_mode: 'Markdown',
                ...successKeyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка при обновлении статуса через пароль:', error);
        
        // Очищаем состояние в любом случае
        userStates.delete(userId);
        
        bot.sendMessage(msg.chat.id, 
            '❌ Ошибка обновления статуса\n\n' +
            '🔧 Произошла техническая ошибка при изменении статуса.\n' +
            'Пароль был правильным, но статус не удалось обновить.\n\n' +
            '📞 Обратитесь к администратору для ручного изменения статуса.',
            { parse_mode: 'Markdown' }
        );
    }
}

// Команда /cancel - отмена текущих операций
bot.onText(/\/cancel/, async (msg) => {
    const userId = msg.from.id;
    
    // Проверяем доступ
    if (!await checkAccess(msg)) return;
    
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, 
            'ℹ️ Нет активных операций для отмены.\n\n' +
            'Используйте /menu для доступа к функциям бота.',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    // Определяем какая операция отменяется
    let operationName = 'Операция';
    switch (userState.state) {
        case 'registration':
            operationName = 'Регистрация';
            break;
        case 'adding_car':
            operationName = 'Добавление автомобиля';
            break;
        case 'creating_invitation':
            operationName = 'Создание приглашения';
            break;
        case 'searching':
            operationName = 'Поиск автомобиля';
            break;
        case 'setting_user_status':
            operationName = 'Изменение статуса пользователя';
            break;
        case 'setting_password':
            operationName = 'Установка пароля';
            break;
        case 'entering_password':
            operationName = 'Ввод пароля для получения статуса';
            break;
    }
    
    // Удаляем состояние пользователя
    userStates.delete(userId);
    
    const cancelKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📋 Главное меню', callback_data: 'menu' }]
            ]
        }
    };
    
    bot.sendMessage(msg.chat.id, 
        `❌ ${operationName} отменена\n\n` +
        '🔄 Вы можете начать новую операцию в любое время.',
        { 
            parse_mode: 'Markdown',
            ...cancelKeyboard 
        }
    );
    
    console.log(`❌ Пользователь ${userId} отменил операцию: ${userState.state}`);
});

// Функции для редактирования профиля

// Показать меню редактирования профиля
async function showEditProfileMenu(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            const notRegisteredKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Зарегистрироваться', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '❌ Вы не зарегистрированы в клубе\n\n' +
                '🚗 Для редактирования профиля необходимо пройти регистрацию.\n\n' +
                '👇 Нажмите кнопку ниже для начала регистрации:',
                { 
                    parse_mode: 'Markdown',
                    ...notRegisteredKeyboard 
                }
            );
            return;
        }
        
        // Запрещаем редактирование для статуса "новый"
        if (member.status === 'новый') {
            const newUserEditKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Пройти регистрацию', callback_data: 'register' }],
                        [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🚫 Редактирование профиля недоступно\n\n' +
                '⚠️ Ваш статус: **новый**\n\n' +
                '📋 Для редактирования профиля необходимо:\n' +
                '1️⃣ Пройти регистрацию в клубе\n' +
                '2️⃣ Получить статус "без авто" или выше\n\n' +
                '✨ После регистрации вы сможете редактировать все поля профиля!',
                { 
                    parse_mode: 'Markdown',
                    ...newUserEditKeyboard 
                }
            );
            return;
        }
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👤 Изменить имя', callback_data: 'edit_first_name' }],
                    [{ text: '📝 Изменить фамилию', callback_data: 'edit_last_name' }],
                    [{ text: '🎂 Изменить дату рождения', callback_data: 'edit_birth_date' }],
                    [{ text: '🏙️ Изменить город', callback_data: 'edit_city' }],
                    [{ text: '🌍 Изменить страну', callback_data: 'edit_country' }],
                    [{ text: '📱 Изменить телефон', callback_data: 'edit_phone' }],
                    [{ text: '💭 Изменить "О себе"', callback_data: 'edit_about' }],
                    [{ text: '📸 Изменить фото', callback_data: 'edit_photo' }],
                    [{ text: '🔙 Назад в профиль', callback_data: 'my_profile' }]
                ]
            }
        };
        
        let menuText = `✏️ Редактирование профиля\n\n`;
        menuText += `👤 **Текущие данные:**\n`;
        menuText += `• Имя: ${member.first_name || 'не указано'}\n`;
        menuText += `• Фамилия: ${member.last_name || 'не указана'}\n`;
        menuText += `• Дата рождения: ${member.birth_date ? formatDate(member.birth_date) : 'не указана'}\n`;
        menuText += `• Город: ${member.city || 'не указан'}\n`;
        menuText += `• Страна: ${member.country || 'не указана'}\n`;
        menuText += `• Телефон: ${member.phone || 'не указан'}\n`;
        menuText += `• О себе: ${member.about ? (member.about.length > 50 ? member.about.substring(0, 50) + '...' : member.about) : 'не указано'}\n`;
        menuText += `• Фото: ${member.photo_url ? 'загружено' : 'не загружено'}\n\n`;
        menuText += `💡 **Выберите поле для редактирования:**\n`;
        menuText += `• Отправьте пустое сообщение для удаления данных\n`;
        menuText += `• Имя нельзя оставлять пустым`;
        
        bot.sendMessage(msg.chat.id, menuText, { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
        
    } catch (error) {
        console.error('Ошибка показа меню редактирования:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки меню редактирования');
    }
}

// Начать редактирование поля
async function startEditField(msg, userId, fieldName, title, prompt, required = false) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Ошибка: пользователь не найден');
            return;
        }
        
        userStates.set(userId, { 
            state: 'editing_profile', 
            step: 'enter_value',
            data: { 
                fieldName: fieldName,
                title: title,
                required: required,
                currentValue: member[fieldName]
            }
        });
        
        let currentValueText = '';
        if (member[fieldName]) {
            if (fieldName === 'birth_date') {
                currentValueText = `\n📅 Текущее значение: ${formatDate(member[fieldName])}`;
            } else {
                currentValueText = `\n📝 Текущее значение: ${member[fieldName]}`;
            }
        } else {
            currentValueText = '\n📝 Текущее значение: не указано';
        }
        
        const cancelKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отменить', callback_data: 'edit_profile' }]
                ]
            }
        };
        
        let promptText = `${title}\n\n${currentValueText}\n\n${prompt}`;
        
        if (!required) {
            promptText += '\n\n💡 Отправьте пустое сообщение для удаления данных';
        }
        
        bot.sendMessage(msg.chat.id, promptText, { 
            parse_mode: 'Markdown',
            ...cancelKeyboard 
        });
        
    } catch (error) {
        console.error('Ошибка начала редактирования поля:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка начала редактирования');
    }
}

// Начать редактирование фото
async function startEditPhoto(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Ошибка: пользователь не найден');
            return;
        }
        
        userStates.set(userId, { 
            state: 'editing_profile', 
            step: 'enter_photo',
            data: { 
                fieldName: 'photo_url',
                title: '📸 Изменение фото профиля',
                currentValue: member.photo_url
            }
        });
        
        const photoKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🗑️ Удалить фото', callback_data: 'delete_photo' }],
                    [{ text: '❌ Отменить', callback_data: 'edit_profile' }]
                ]
            }
        };
        
        let photoText = `📸 Изменение фото профиля\n\n`;
        photoText += `📝 Текущее состояние: ${member.photo_url ? 'фото загружено' : 'фото не загружено'}\n\n`;
        photoText += `📷 Отправьте новое фото или используйте кнопки ниже:`;
        
        bot.sendMessage(msg.chat.id, photoText, { 
            parse_mode: 'Markdown',
            ...photoKeyboard 
        });
        
    } catch (error) {
        console.error('Ошибка начала редактирования фото:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка начала редактирования фото');
    }
}

// Обработка редактирования профиля
async function handleEditProfile(msg, userId, userState) {
    const { fieldName, title, required, currentValue } = userState.data;
    
    try {
        if (userState.step === 'enter_value') {
            let newValue = msg.text ? msg.text.trim() : '';
            
            // Проверка обязательных полей
            if (required && !newValue) {
                bot.sendMessage(msg.chat.id, 
                    `❌ Поле "${title}" не может быть пустым\n\n` +
                    'Введите корректное значение:'
                );
                return;
            }
            
            // Валидация даты рождения
            if (fieldName === 'birth_date' && newValue) {
                const dateValidation = validateBirthDate(newValue);
                if (!dateValidation.valid) {
                    bot.sendMessage(msg.chat.id, 
                        `❌ ${dateValidation.error}\n\n` +
                        'Введите дату в формате ДД.ММ.ГГГГ (например: 15.03.1990):'
                    );
                    return;
                }
                newValue = dateValidation.date; // Используем отформатированную дату
            }
            
            // Обновляем поле в базе данных
            const updateData = {};
            updateData[fieldName] = newValue || null;
            
            const result = await db.updateMember(userId, updateData);
            
            if (result.affectedRows === 0) {
                userStates.delete(userId);
                bot.sendMessage(msg.chat.id, '❌ Ошибка обновления данных');
                return;
            }
            
            userStates.delete(userId);
            
            // Успешное обновление
            const successKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✏️ Продолжить редактирование', callback_data: 'edit_profile' }],
                        [{ text: '👤 Мой профиль', callback_data: 'my_profile' }],
                        [{ text: '📋 Главное меню', callback_data: 'menu' }]
                    ]
                }
            };
            
            let successText = `✅ Поле обновлено успешно!\n\n`;
            successText += `${title.replace('Изменение', 'Обновлено')}\n\n`;
            
            if (newValue) {
                if (fieldName === 'birth_date') {
                    successText += `📅 Новое значение: ${formatDate(newValue)}`;
                } else {
                    successText += `📝 Новое значение: ${newValue}`;
                }
            } else {
                successText += `🗑️ Данные удалены`;
            }
            
            bot.sendMessage(msg.chat.id, successText, { 
                parse_mode: 'Markdown',
                ...successKeyboard 
            });
            
        } else if (userState.step === 'enter_photo') {
            // Обработка фото будет в отдельном обработчике фотографий
            bot.sendMessage(msg.chat.id, 
                '📸 Ожидается фотография\n\n' +
                'Отправьте фото или используйте кнопки ниже'
            );
        }
        
    } catch (error) {
        console.error('Ошибка обработки редактирования профиля:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка. Попробуйте ещё раз.');
    }
}

// Валидация даты рождения
function validateBirthDate(dateString) {
    console.log('🔍 validateBirthDate вызвана с:', dateString);
    
    if (!dateString || dateString.trim() === '') {
        console.log('  Пустая дата - разрешено');
        return { valid: true, date: null }; // Пустая дата допустима
    }
    
    // Проверяем формат ДД.ММ.ГГГГ
    const dateRegex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
    const match = dateString.match(dateRegex);
    
    if (!match) {
        console.log('  Неверный формат');
        return { 
            valid: false, 
            error: 'Неверный формат даты. Используйте ДД.ММ.ГГГГ' 
        };
    }
    
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    
    console.log(`  Разобранная дата: день=${day}, месяц=${month}, год=${year}`);
    
    // Проверяем корректность даты
    const date = new Date(year, month - 1, day);
    
    if (date.getFullYear() !== year || 
        date.getMonth() !== month - 1 || 
        date.getDate() !== day) {
        console.log('  Некорректная дата');
        return { 
            valid: false, 
            error: 'Некорректная дата. Проверьте день, месяц и год' 
        };
    }
    
    // Проверяем разумные ограничения
    const currentYear = new Date().getFullYear();
    if (year < 1900 || year > currentYear - 10) {
        console.log(`  Год вне диапазона: ${year}, допустимо: 1900-${currentYear - 10}`);
        return { 
            valid: false, 
            error: `Год должен быть между 1900 и ${currentYear - 10}` 
        };
    }
    
    // Возвращаем дату в формате YYYY-MM-DD для MySQL
    const formattedDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    
    console.log(`  Валидная дата: ${formattedDate}`);
    return { 
        valid: true, 
        date: formattedDate 
    };
}

// Обработка фото при редактировании профиля
async function handleEditProfilePhoto(msg, userId, userState) {
    try {
        const photo = msg.photo[msg.photo.length - 1]; // Берем фото наибольшего размера
        const fileName = `${userId}_${Date.now()}.jpg`;
        
        // Скачиваем фото
        const photoPath = await downloadPhoto(photo.file_id, fileName);
        
        if (!photoPath) {
            bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки фото. Попробуйте ещё раз.');
            return;
        }
        
        // Обновляем фото в базе данных
        const result = await db.updateMember(userId, { photo_url: fileName });
        
        if (result.affectedRows === 0) {
            userStates.delete(userId);
            bot.sendMessage(msg.chat.id, '❌ Ошибка обновления фото в базе данных');
            return;
        }
        
        userStates.delete(userId);
        
        // Успешное обновление
        const successKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Продолжить редактирование', callback_data: 'edit_profile' }],
                    [{ text: '👤 Мой профиль', callback_data: 'my_profile' }],
                    [{ text: '📋 Главное меню', callback_data: 'menu' }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            '✅ Фото профиля обновлено успешно!\n\n' +
            '📸 Новое фото сохранено и будет отображаться в вашем профиле.',
            { 
                parse_mode: 'Markdown',
                ...successKeyboard 
            }
        );
        
                 console.log(`📸 Обновлено фото профиля для пользователя ${userId}: ${fileName}`);
         
     } catch (error) {
         console.error('Ошибка обработки фото профиля:', error);
         userStates.delete(userId);
         bot.sendMessage(msg.chat.id, '❌ Ошибка при обработке фотографии. Попробуйте ещё раз.');
     }
 }

// Удаление фото профиля
async function deleteProfilePhoto(msg, userId) {
    try {
        const userState = userStates.get(userId);
        if (!userState || userState.state !== 'editing_profile') {
            bot.sendMessage(msg.chat.id, '❌ Ошибка: неверное состояние');
            return;
        }
        
        // Удаляем фото из базы данных
        const result = await db.updateMember(userId, { photo_url: null });
        
        if (result.affectedRows === 0) {
            userStates.delete(userId);
            bot.sendMessage(msg.chat.id, '❌ Ошибка удаления фото');
            return;
        }
        
        userStates.delete(userId);
        
        // Успешное удаление
        const successKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Продолжить редактирование', callback_data: 'edit_profile' }],
                    [{ text: '👤 Мой профиль', callback_data: 'my_profile' }],
                    [{ text: '📋 Главное меню', callback_data: 'menu' }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            '✅ Фото профиля удалено успешно!\n\n' +
            '🗑️ Фото больше не будет отображаться в вашем профиле.',
            { 
                parse_mode: 'Markdown',
                ...successKeyboard 
            }
        );
        
        console.log(`🗑️ Удалено фото профиля для пользователя ${userId}`);
        
    } catch (error) {
        console.error('Ошибка удаления фото профиля:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Ошибка при удалении фотографии');
    }
}

// Функция показа меню редактирования автомобиля
async function showEditCarMenu(msg, userId, carId) {
    try {
        // Проверяем права доступа
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            bot.answerCallbackQuery(msg.id, '❌ Вы не зарегистрированы в клубе');
            return;
        }
        
        // Получаем информацию об автомобиле
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car) {
            bot.answerCallbackQuery(msg.id, '❌ Автомобиль не найден');
            return;
        }
        
        // Проверяем права доступа (владелец или админ)
        if (car.member_id !== member.id && !isAdmin(userId)) {
            bot.answerCallbackQuery(msg.id, '❌ Нет прав для редактирования');
            return;
        }
        
        let menuText = `✏️ Редактирование автомобиля\n\n`;
        menuText += `🚗 **${car.brand} ${car.model}**\n`;
        if (car.generation) menuText += `📋 Поколение: ${car.generation}\n`;
        menuText += `📅 Год: ${car.year}\n`;
        menuText += `🔢 Номер: ${car.reg_number || 'не указан'}\n`;
        menuText += `🎨 Цвет: ${car.color || 'не указан'}\n`;
        menuText += `📊 Статус: ${car.status}\n`;
        menuText += `💭 Описание: ${car.description || 'не указано'}\n`;
        
        // Информация о фотографиях
        let photosCount = 0;
        if (car.photos && car.photos.trim() !== '') {
            try {
                const photos = JSON.parse(car.photos);
                photosCount = photos ? photos.length : 0;
            } catch (e) {
                photosCount = 0;
            }
        }
        menuText += `📷 Фотографий: ${photosCount}/10\n\n`;
        menuText += `👇 Выберите что хотите изменить:`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🏭 Марка', callback_data: `edit_car_brand_${carId}` },
                        { text: '🚗 Модель', callback_data: `edit_car_model_${carId}` }
                    ],
                    [
                        { text: '📋 Поколение', callback_data: `edit_car_generation_${carId}` },
                        { text: '📅 Год', callback_data: `edit_car_year_${carId}` }
                    ],
                    [
                        { text: '🔢 Номер', callback_data: `edit_car_reg_number_${carId}` },
                        { text: '🎨 Цвет', callback_data: `edit_car_color_${carId}` }
                    ],
                    [
                        { text: '💭 Описание', callback_data: `edit_car_description_${carId}` }
                    ],
                    [
                        { text: '📷 Добавить фото', callback_data: `edit_car_add_photo_${carId}` }
                    ]
                ]
            }
        };
        
        // Добавляем кнопку управления фото если есть фотографии
        if (photosCount > 0) {
            keyboard.reply_markup.inline_keyboard.splice(-1, 0, [
                { text: '🗑️ Удалить фото', callback_data: `edit_car_delete_photo_${carId}` }
            ]);
        }
        
        // Добавляем кнопку удаления авто для админов
        if (isAdmin(userId)) {
            keyboard.reply_markup.inline_keyboard.push([
                { text: '🗑️ Удалить автомобиль', callback_data: `delete_car_${carId}` }
            ]);
        }
        
        // Всегда добавляем кнопку "Назад"
        keyboard.reply_markup.inline_keyboard.push([
            { text: '🔙 Назад к автомобилям', callback_data: 'my_cars' }
        ]);
        
        try {
            await bot.editMessageText(menuText, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                ...keyboard
            });
        } catch (editError) {
            await bot.sendMessage(msg.chat.id, menuText, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        }
        
    } catch (error) {
        console.error('Ошибка показа меню редактирования авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка');
    }
}

// Функция начала редактирования поля автомобиля
async function startEditCarField(msg, userId, carId, fieldName, title, prompt, required = false) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car || (car.member_id !== member.id && !isAdmin(userId))) {
            bot.answerCallbackQuery(msg.id, '❌ Нет прав для редактирования');
            return;
        }
        
        // Устанавливаем состояние редактирования автомобиля
        userStates.set(userId, {
            state: 'editing_car',
            step: `edit_${fieldName}`,
            data: { carId, fieldName, required }
        });
        
        const keyboard = required ? {} : {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Отменить', callback_data: `edit_car_${carId}` }]
                ]
            }
        };
        
        let promptText = `${title}\n\n`;
        if (car[fieldName]) {
            promptText += `📝 Текущее значение: **${car[fieldName]}**\n\n`;
        }
        promptText += prompt;
        
        if (!required) {
            promptText += `\n\n💡 Отправьте пустое сообщение для удаления значения`;
        }
        
        bot.sendMessage(msg.chat.id, promptText, {
            parse_mode: 'Markdown',
            ...keyboard
        });
        
    } catch (error) {
        console.error('Ошибка начала редактирования поля авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка');
    }
}

// Функция начала добавления фото к автомобилю
async function startEditCarPhoto(msg, userId, carId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car || (car.member_id !== member.id && !isAdmin(userId))) {
            bot.answerCallbackQuery(msg.id, '❌ Нет прав для редактирования');
            return;
        }
        
        // Проверяем количество существующих фото
        let currentPhotosCount = 0;
        if (car.photos && car.photos.trim() !== '') {
            try {
                const photos = JSON.parse(car.photos);
                currentPhotosCount = photos ? photos.length : 0;
            } catch (e) {
                currentPhotosCount = 0;
            }
        }
        
        if (currentPhotosCount >= 10) {
            bot.answerCallbackQuery(msg.id, '❌ Достигнут лимит фотографий (10)');
            return;
        }
        
        // Устанавливаем состояние добавления фото
        userStates.set(userId, {
            state: 'editing_car',
            step: 'add_photo',
            data: { carId }
        });
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Отменить', callback_data: `edit_car_${carId}` }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            `📷 Добавление фото к автомобилю\n\n` +
            `🚗 ${car.brand} ${car.model}\n` +
            `📊 Текущих фото: ${currentPhotosCount}/10\n\n` +
            `📸 Отправьте новую фотографию автомобиля\n\n` +
            `💡 **Можно отправить несколько фото подряд!**\n` +
            `• Новые фото станут главными (будут показываться первыми)\n` +
            `• Отправляйте по одному или выберите несколько и отправьте\n` +
            `• После загрузки всех фото нажмите "🔙 Отменить" для возврата`,
            {
                parse_mode: 'Markdown',
                ...keyboard
            }
        );
        
    } catch (error) {
        console.error('Ошибка начала добавления фото авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка');
    }
}

// Функция обработки редактирования автомобиля
async function handleEditCar(msg, userId, userState) {
    const step = userState.step;
    const data = userState.data;
    
    try {
        if (step.startsWith('edit_')) {
            const fieldName = data.fieldName;
            const carId = data.carId;
            const inputValue = msg.text.trim();
            
            // Специальная обработка для года
            if (fieldName === 'year') {
                const year = parseInt(inputValue);
                if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
                    bot.sendMessage(msg.chat.id, 
                        `❌ Некорректный год\n\n` +
                        `Введите год от 1900 до ${new Date().getFullYear() + 1}`,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
            }
            
            // Подготавливаем данные для обновления
            const updateData = {};
            
            // Если пустое сообщение и поле не обязательное - удаляем значение
            if (inputValue === '' && !data.required) {
                updateData[fieldName] = null;
            } else if (inputValue !== '') {
                updateData[fieldName] = inputValue;
            } else if (data.required) {
                bot.sendMessage(msg.chat.id, 
                    `❌ Это поле обязательно для заполнения\n\n` +
                    `Введите корректное значение:`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            // Обновляем автомобиль в базе данных
            const result = await db.updateCar(carId, updateData);
            
            if (result.affectedRows > 0) {
                // Проверяем приглашения если изменился номер
                if (fieldName === 'reg_number' && inputValue !== '') {
                    await checkAndUpdateInvitationStatus(inputValue, carId);
                }
                
                userStates.delete(userId);
                
                bot.sendMessage(msg.chat.id, 
                    `✅ Поле "${getFieldDisplayName(fieldName)}" успешно обновлено!\n\n` +
                    `🔄 Возвращаемся к меню редактирования...`,
                    { parse_mode: 'Markdown' }
                );
                
                // Показываем обновленное меню редактирования
                setTimeout(async () => {
                    await showEditCarMenu(msg, userId, carId);
                }, 1000);
            } else {
                bot.sendMessage(msg.chat.id, 
                    `❌ Ошибка обновления поля\n\n` +
                    `Попробуйте ещё раз или обратитесь к администратору.`,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    } catch (error) {
        console.error('Ошибка обработки редактирования авто:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка при сохранении изменений');
    }
}

// Функция обработки фото для редактирования автомобиля
async function handleEditCarPhoto(msg, userId, userState) {
    const carId = userState.data.carId;
    
    try {
        // Получаем информацию об автомобиле
        const member = await db.getMemberByTelegramId(userId);
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car) {
            bot.sendMessage(msg.chat.id, '❌ Автомобиль не найден');
            userStates.delete(userId);
            return;
        }
        
        // Проверяем текущее количество фото
        let currentPhotos = [];
        if (car.photos && car.photos.trim() !== '') {
            try {
                currentPhotos = JSON.parse(car.photos) || [];
            } catch (e) {
                currentPhotos = [];
            }
        }
        
        if (currentPhotos.length >= 10) {
            bot.sendMessage(msg.chat.id, '❌ Достигнут лимит фотографий (10)');
            userStates.delete(userId);
            return;
        }
        
        // Скачиваем фото
        const photo = msg.photo[msg.photo.length - 1]; // Берем фото наибольшего размера
        const fileName = `car_${carId}_${Date.now()}.jpg`;
        
        const downloadResult = await downloadCarPhoto(photo.file_id, fileName);
        
        if (downloadResult.success) {
            // Добавляем новое фото в начало массива (становится главным)
            const updatedPhotos = [fileName, ...currentPhotos];
            
            // Обновляем автомобиль в базе данных
            const result = await db.updateCar(carId, { photos: JSON.stringify(updatedPhotos) });
            
            if (result.affectedRows > 0) {
                // НЕ удаляем состояние, чтобы можно было добавить еще фото
                
                const continueKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📸 Еще фото', callback_data: 'continue_adding_photos' }],
                            [{ text: '✅ Готово', callback_data: `edit_car_${carId}` }]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, 
                    `✅ Фотография ${updatedPhotos.length} успешно добавлена!\n\n` +
                    `📷 Всего фото у автомобиля: ${updatedPhotos.length}/10\n` +
                    `🎯 Новое фото стало главным\n\n` +
                    `📸 **Можете добавить еще фото** или завершить:`,
                    { 
                        parse_mode: 'Markdown',
                        ...continueKeyboard 
                    }
                );
            } else {
                bot.sendMessage(msg.chat.id, '❌ Ошибка сохранения фотографии');
                userStates.delete(userId);
            }
        } else {
            bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки фотографии');
            userStates.delete(userId);
        }
        
    } catch (error) {
        console.error('Ошибка обработки фото авто:', error);
        userStates.delete(userId);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка при обработке фотографии');
    }
}

// Функция проверки и обновления статуса приглашения
async function checkAndUpdateInvitationStatus(regNumber, carId) {
    try {
        if (!regNumber) return;
        
        // 1. Ищем автомобили-приглашения с таким же номером
        const existingCars = await db.getCarsByRegNumber(regNumber);
        const invitationCars = existingCars.filter(car => 
            car.status === 'приглашение' && 
            car.id.toString() !== carId.toString()
        );
        
        // Переводим автомобили-приглашения в статус "в клубе"
        for (const invitationCar of invitationCars) {
            try {
                await db.updateCar(invitationCar.id, { status: 'в клубе' });
                console.log(`✅ Автомобиль-приглашение ${invitationCar.id} (${regNumber}) переведен в статус "в клубе"`);
                
                // Обновляем связанные приглашения
                const carInvitations = await db.getInvitationsByCar(invitationCar.id);
                for (const invitation of carInvitations) {
                    if (invitation.status === 'новое' || invitation.status === 'ожидание') {
                        await db.updateInvitation(invitation.id, { 
                            status: 'вступил в клуб',
                            response_date: new Date().toISOString().split('T')[0],
                            club_car_id: carId // Добавляем связь с машиной в клубе
                        });
                        console.log(`✅ Обновлен статус приглашения ${invitation.id}: номер ${regNumber} вступил в клуб, связан с машиной ${carId}`);
                    }
                }
            } catch (updateError) {
                console.error(`Ошибка обновления автомобиля-приглашения ${invitationCar.id}:`, updateError);
            }
        }
        
        // 2. Ищем приглашения связанные с текущим автомобилем (если он сам был приглашением)
        const currentCarInvitations = await db.getInvitationsByCar(carId);
        for (const invitation of currentCarInvitations) {
            if (invitation.status === 'новое' || invitation.status === 'ожидание') {
                await db.updateInvitation(invitation.id, { 
                    status: 'вступил в клуб',
                    response_date: new Date().toISOString().split('T')[0],
                    club_car_id: carId // Добавляем связь с машиной в клубе
                });
                console.log(`✅ Обновлен статус приглашения ${invitation.id}: номер ${regNumber} добавлен к автомобилю, связан с машиной ${carId}`);
            }
        }
        
        // 3. Ищем ВСЕ приглашения с таким же номером (независимо от car_id)
        // Это нужно для случаев когда номер есть в приглашениях, но нет автомобиля-приглашения
        const allInvitations = await db.getInvitationsByCarNumber(regNumber);
        for (const invitation of allInvitations) {
            if ((invitation.status === 'новое' || invitation.status === 'ожидание') && !invitation.club_car_id) {
                await db.updateInvitation(invitation.id, { 
                    status: 'вступил в клуб',
                    response_date: new Date().toISOString().split('T')[0],
                    club_car_id: carId // Добавляем связь с машиной в клубе
                });
                console.log(`✅ Обновлен статус приглашения ${invitation.id}: номер ${regNumber} найден в приглашениях, связан с машиной ${carId}`);
            }
        }
        
    } catch (error) {
        console.error('Ошибка проверки приглашений:', error);
    }
}

// Функция показа меню удаления фото автомобиля
async function showDeleteCarPhotoMenu(msg, userId, carId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car || (car.member_id !== member.id && !isAdmin(userId))) {
            bot.answerCallbackQuery(msg.id, '❌ Нет прав для редактирования');
            return;
        }
        
        // Проверяем наличие фото
        let currentPhotos = [];
        if (car.photos && car.photos.trim() !== '') {
            try {
                currentPhotos = JSON.parse(car.photos) || [];
            } catch (e) {
                currentPhotos = [];
            }
        }
        
        if (currentPhotos.length === 0) {
            bot.answerCallbackQuery(msg.id, '❌ У автомобиля нет фотографий');
            return;
        }
        
        if (currentPhotos.length === 1) {
            bot.answerCallbackQuery(msg.id, '❌ Нельзя удалить последнее фото');
            return;
        }
        
        let menuText = `🗑️ Удаление фото автомобиля\n\n`;
        menuText += `🚗 **${car.brand} ${car.model}**\n`;
        menuText += `📷 Всего фотографий: ${currentPhotos.length}\n\n`;
        menuText += `⚠️ **Внимание:** Минимум 1 фото должно остаться\n\n`;
        menuText += `👇 Выберите фото для удаления:`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: []
            }
        };
        
        // Добавляем кнопки для каждого фото (кроме последнего если оно единственное)
        currentPhotos.forEach((photo, index) => {
            if (currentPhotos.length > 1) { // Можем удалить только если больше 1 фото
                keyboard.reply_markup.inline_keyboard.push([
                    { 
                        text: `🗑️ Удалить фото ${index + 1} ${index === 0 ? '(главное)' : ''}`, 
                        callback_data: `delete_car_photo_${carId}_${index}` 
                    }
                ]);
            }
        });
        
        // Кнопка "Удалить все кроме главного"
        if (currentPhotos.length > 1) {
            keyboard.reply_markup.inline_keyboard.push([
                { text: '🗑️ Удалить все кроме главного', callback_data: `delete_car_photos_except_main_${carId}` }
            ]);
        }
        
        // Кнопка "Назад"
        keyboard.reply_markup.inline_keyboard.push([
            { text: '🔙 Назад к редактированию', callback_data: `edit_car_${carId}` }
        ]);
        
        try {
            await bot.editMessageText(menuText, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                ...keyboard
            });
        } catch (editError) {
            await bot.sendMessage(msg.chat.id, menuText, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        }
        
    } catch (error) {
        console.error('Ошибка показа меню удаления фото авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка');
    }
}

// Функция удаления конкретного фото автомобиля
async function deleteCarPhoto(msg, userId, carId, photoIndex) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car || (car.member_id !== member.id && !isAdmin(userId))) {
            bot.answerCallbackQuery(msg.id, '❌ Нет прав для редактирования');
            return;
        }
        
        // Получаем текущие фото
        let currentPhotos = [];
        if (car.photos && car.photos.trim() !== '') {
            try {
                currentPhotos = JSON.parse(car.photos) || [];
            } catch (e) {
                currentPhotos = [];
            }
        }
        
        if (currentPhotos.length <= 1) {
            bot.answerCallbackQuery(msg.id, '❌ Нельзя удалить последнее фото');
            return;
        }
        
        if (photoIndex >= currentPhotos.length) {
            bot.answerCallbackQuery(msg.id, '❌ Фото не найдено');
            return;
        }
        
        // Удаляем фото из массива
        const deletedPhoto = currentPhotos.splice(photoIndex, 1)[0];
        
        // Удаляем физический файл
        try {
            const fs = require('fs');
            const path = require('path');
            const photoPath = path.resolve(config.UPLOADS.carsPath, deletedPhoto);
            if (fs.existsSync(photoPath)) {
                fs.unlinkSync(photoPath);
                console.log(`🗑️ Удален файл фото: ${deletedPhoto}`);
            }
        } catch (fileError) {
            console.error('Ошибка удаления файла фото:', fileError);
            // Продолжаем даже если файл не удалился
        }
        
        // Обновляем базу данных
        const result = await db.updateCar(carId, { photos: JSON.stringify(currentPhotos) });
        
        if (result.affectedRows > 0) {
            bot.sendMessage(msg.chat.id, 
                `✅ Фото ${photoIndex + 1} успешно удалено!\n\n` +
                `📷 Осталось фотографий: ${currentPhotos.length}\n\n` +
                `🔄 Возвращаемся к меню редактирования...`,
                { parse_mode: 'Markdown' }
            );
            
            // Показываем обновленное меню редактирования
            setTimeout(async () => {
                await showEditCarMenu(msg, userId, carId);
            }, 1000);
        } else {
            bot.sendMessage(msg.chat.id, '❌ Ошибка удаления фото из базы данных');
        }
        
    } catch (error) {
        console.error('Ошибка удаления фото авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка при удалении');
    }
}

// Функция удаления всех фото кроме главного
async function deleteCarPhotosExceptMain(msg, userId, carId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car || (car.member_id !== member.id && !isAdmin(userId))) {
            bot.answerCallbackQuery(msg.id, '❌ Нет прав для редактирования');
            return;
        }
        
        // Получаем текущие фото
        let currentPhotos = [];
        if (car.photos && car.photos.trim() !== '') {
            try {
                currentPhotos = JSON.parse(car.photos) || [];
            } catch (e) {
                currentPhotos = [];
            }
        }
        
        if (currentPhotos.length <= 1) {
            bot.answerCallbackQuery(msg.id, '❌ У автомобиля только одно фото');
            return;
        }
        
        const mainPhoto = currentPhotos[0]; // Главное фото (первое)
        const photosToDelete = currentPhotos.slice(1); // Все остальные
        
        // Удаляем физические файлы
        const fs = require('fs');
        const path = require('path');
        let deletedCount = 0;
        
        photosToDelete.forEach(photoName => {
            try {
                const photoPath = path.resolve(config.UPLOADS.carsPath, photoName);
                if (fs.existsSync(photoPath)) {
                    fs.unlinkSync(photoPath);
                    deletedCount++;
                    console.log(`🗑️ Удален файл фото: ${photoName}`);
                }
            } catch (fileError) {
                console.error('Ошибка удаления файла фото:', fileError);
            }
        });
        
        // Оставляем только главное фото
        const updatedPhotos = [mainPhoto];
        
        // Обновляем базу данных
        const result = await db.updateCar(carId, { photos: JSON.stringify(updatedPhotos) });
        
        if (result.affectedRows > 0) {
            bot.sendMessage(msg.chat.id, 
                `✅ Удалено ${photosToDelete.length} фотографий!\n\n` +
                `📷 Оставлено: 1 главное фото\n` +
                `🗑️ Удалено файлов: ${deletedCount}\n\n` +
                `🔄 Возвращаемся к меню редактирования...`,
                { parse_mode: 'Markdown' }
            );
            
            // Показываем обновленное меню редактирования
            setTimeout(async () => {
                await showEditCarMenu(msg, userId, carId);
            }, 1000);
        } else {
            bot.sendMessage(msg.chat.id, '❌ Ошибка обновления базы данных');
        }
        
    } catch (error) {
        console.error('Ошибка удаления фото авто кроме главного:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка при удалении');
    }
}

// Функция показа подтверждения удаления автомобиля
async function showDeleteCarConfirmation(msg, userId, carId) {
    try {
        // Проверяем права админа
        if (!isAdmin(userId)) {
            bot.answerCallbackQuery(msg.id, '❌ Только администраторы могут удалять автомобили');
            return;
        }
        
        // Получаем автомобиль напрямую по ID (админ может удалять любые авто)
        const allCars = await db.getAllCars();
        const car = allCars.find(c => c.id.toString() === carId.toString());
        
        if (!car) {
            bot.answerCallbackQuery(msg.id, '❌ Автомобиль не найден');
            return;
        }
        
        // Получаем информацию о владельце автомобиля
        const owner = await db.getMemberById(car.member_id);
        
        let confirmText = `⚠️ **ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ АВТОМОБИЛЯ**\n\n`;
        confirmText += `🚗 **Автомобиль:** ${car.brand} ${car.model}`;
        if (car.generation) confirmText += ` (${car.generation})`;
        confirmText += `\n📅 Год: ${car.year}`;
        if (car.reg_number) confirmText += `\n🔢 Номер: ${car.reg_number}`;
        confirmText += `\n📊 Статус: ${car.status}`;
        
        if (owner) {
            confirmText += `\n\n👤 **Владелец:** ${owner.first_name}`;
            if (owner.last_name) confirmText += ` ${owner.last_name}`;
            if (owner.nickname) confirmText += ` (@${owner.nickname})`;
        }
        
        // Информация о фотографиях
        let photosCount = 0;
        if (car.photos && car.photos.trim() !== '') {
            try {
                const photos = JSON.parse(car.photos);
                photosCount = photos ? photos.length : 0;
            } catch (e) {
                photosCount = 0;
            }
        }
        confirmText += `\n📷 Фотографий: ${photosCount}`;
        
        // Проверяем приглашения
        const invitations = await db.getInvitationsByCar(carId);
        if (invitations.length > 0) {
            confirmText += `\n📮 Приглашений: ${invitations.length}`;
        }
        
        confirmText += `\n\n🔥 **ВНИМАНИЕ!**`;
        confirmText += `\n• Автомобиль будет удален **НАВСЕГДА**`;
        confirmText += `\n• Все фотографии будут удалены с диска`;
        if (invitations.length > 0) {
            confirmText += `\n• Все связанные приглашения будут удалены`;
        }
        confirmText += `\n• Это действие **НЕОБРАТИМО**`;
        
        confirmText += `\n\n❓ Вы уверены что хотите удалить этот автомобиль?`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔥 ДА, УДАЛИТЬ', callback_data: `confirm_delete_car_${carId}` }
                    ],
                    [
                        { text: '❌ Отменить', callback_data: `edit_car_${carId}` }
                    ]
                ]
            }
        };
        
        try {
            await bot.editMessageText(confirmText, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                ...keyboard
            });
        } catch (editError) {
            await bot.sendMessage(msg.chat.id, confirmText, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        }
        
    } catch (error) {
        console.error('Ошибка показа подтверждения удаления авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка');
    }
}

// Функция полного удаления автомобиля
async function deleteCarCompletely(msg, userId, carId) {
    try {
        // Проверяем права админа
        if (!isAdmin(userId)) {
            bot.answerCallbackQuery(msg.id, '❌ Только администраторы могут удалять автомобили');
            return;
        }
        
        // Получаем информацию об автомобиле перед удалением (админ может удалять любые авто)
        const allCars = await db.getAllCars();
        const car = allCars.find(c => c.id.toString() === carId.toString());
        
        if (!car) {
            bot.answerCallbackQuery(msg.id, '❌ Автомобиль не найден');
            return;
        }
        
        // Получаем владельца для логирования
        const owner = await db.getMemberById(car.member_id);
        
        let deletedPhotosCount = 0;
        let deletedInvitationsCount = 0;
        
        // 1. Удаляем все фотографии с диска
        if (car.photos && car.photos.trim() !== '') {
            try {
                const photos = JSON.parse(car.photos);
                if (photos && photos.length > 0) {
                    const fs = require('fs');
                    const path = require('path');
                    
                    photos.forEach(photoName => {
                        try {
                            const photoPath = path.resolve(config.UPLOADS.carsPath, photoName);
                            if (fs.existsSync(photoPath)) {
                                fs.unlinkSync(photoPath);
                                deletedPhotosCount++;
                                console.log(`🗑️ Удален файл фото: ${photoName}`);
                            }
                        } catch (fileError) {
                            console.error('Ошибка удаления файла фото:', fileError);
                        }
                    });
                }
            } catch (e) {
                console.error('Ошибка парсинга фотографий:', e);
            }
        }
        
        // 2. Удаляем все приглашения связанные с автомобилем
        const invitations = await db.getInvitationsByCar(carId);
        for (const invitation of invitations) {
            try {
                await db.updateInvitation(invitation.id, { status: 'удален' });
                deletedInvitationsCount++;
            } catch (invError) {
                console.error('Ошибка обновления приглашения:', invError);
            }
        }
        
        // 3. Удаляем автомобиль из базы данных
        // Сначала проверим есть ли функция deleteCar, если нет - используем updateCar
        try {
            // Помечаем как удаленный вместо полного удаления для сохранения истории
            const result = await db.updateCar(carId, { 
                status: 'удален',
                member_id: null
            });
            
            if (result.affectedRows > 0) {
                // Логируем удаление
                console.log(`🗑️ Автомобиль удален админом ${userId}:`);
                console.log(`   Авто: ${car.brand} ${car.model} (ID: ${carId})`);
                console.log(`   Владелец: ${owner ? owner.first_name : 'неизвестен'} (ID: ${car.member_id})`);
                console.log(`   Удалено фото: ${deletedPhotosCount}`);
                console.log(`   Обновлено приглашений: ${deletedInvitationsCount}`);
                
                let successText = `✅ **Автомобиль успешно удален!**\n\n`;
                successText += `🚗 ${car.brand} ${car.model}`;
                if (car.reg_number) successText += ` (${car.reg_number})`;
                successText += `\n\n📊 **Статистика удаления:**`;
                successText += `\n🗑️ Удалено фото: ${deletedPhotosCount}`;
                successText += `\n📮 Обновлено приглашений: ${deletedInvitationsCount}`;
                successText += `\n💾 Автомобиль помечен как удаленный`;
                
                if (owner) {
                    successText += `\n\n👤 **Владелец уведомлен:** ${owner.first_name}`;
                    if (owner.last_name) successText += ` ${owner.last_name}`;
                    
                    // Отправляем уведомление владельцу
                    try {
                        await bot.sendMessage(owner.telegram_id, 
                            `⚠️ **Ваш автомобиль удален администратором**\n\n` +
                            `🚗 ${car.brand} ${car.model}` +
                            (car.reg_number ? ` (${car.reg_number})` : '') + `\n\n` +
                            `📅 Дата удаления: ${new Date().toLocaleDateString('ru-RU')}\n\n` +
                            `💬 По вопросам обращайтесь к администраторам клуба.`,
                            { parse_mode: 'Markdown' }
                        );
                        console.log(`📧 Уведомление отправлено владельцу ${owner.telegram_id}`);
                    } catch (notifyError) {
                        console.error('Ошибка отправки уведомления владельцу:', notifyError);
                        successText += `\n⚠️ Ошибка отправки уведомления владельцу`;
                    }
                }
                
                successText += `\n\n🔄 Возвращаемся к списку автомобилей...`;
                
                const successKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚗 Мои автомобили', callback_data: 'my_cars' }],
                            [{ text: '📋 Главное меню', callback_data: 'menu' }]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, successText, {
                    parse_mode: 'Markdown',
                    ...successKeyboard
                });
                
            } else {
                bot.sendMessage(msg.chat.id, '❌ Ошибка удаления автомобиля из базы данных');
            }
            
        } catch (dbError) {
            console.error('Ошибка удаления автомобиля из БД:', dbError);
            bot.sendMessage(msg.chat.id, '❌ Ошибка удаления автомобиля из базы данных');
        }
        
    } catch (error) {
        console.error('Ошибка полного удаления автомобиля:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка при удалении');
    }
}

// Функция показа подтверждения продажи автомобиля
async function showSellCarConfirmation(msg, userId, carId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car) {
            bot.answerCallbackQuery(msg.id, '❌ Автомобиль не найден');
            return;
        }
        
        // Проверяем, что пользователь является владельцем
        if (car.member_id !== member.id) {
            bot.answerCallbackQuery(msg.id, '❌ Вы не являетесь владельцем этого автомобиля');
            return;
        }
        
        let confirmText = `💸 **ПОДТВЕРЖДЕНИЕ ПРОДАЖИ АВТОМОБИЛЯ**\n\n`;
        confirmText += `🚗 **Автомобиль:** ${car.brand} ${car.model}`;
        if (car.generation) confirmText += ` (${car.generation})`;
        confirmText += `\n📅 Год: ${car.year}`;
        if (car.reg_number) confirmText += `\n🔢 Номер: ${car.reg_number}`;
        if (car.color) confirmText += `\n🎨 Цвет: ${car.color}`;
        confirmText += `\n📊 Текущий статус: ${car.status}`;
        
        // Информация о фотографиях
        let photosCount = 0;
        if (car.photos && car.photos.trim() !== '') {
            try {
                const photos = JSON.parse(car.photos);
                photosCount = photos ? photos.length : 0;
            } catch (e) {
                photosCount = 0;
            }
        }
        confirmText += `\n📷 Фотографий: ${photosCount}`;
        
        confirmText += `\n\n💸 **ЧТО ПРОИЗОЙДЕТ ПРИ ПРОДАЖЕ:**`;
        confirmText += `\n• Вы **перестанете быть владельцем** этого автомобиля`;
        confirmText += `\n• Автомобиль получит статус **"продан"**`;
        confirmText += `\n• Автомобиль **останется в базе** клуба для истории`;
        confirmText += `\n• Фотографии **сохранятся** в системе`;
        confirmText += `\n• Новый владелец сможет **добавить этот автомобиль** себе`;
        
        // Проверяем приглашения
        const invitations = await db.getInvitationsByCar(carId);
        if (invitations.length > 0) {
            confirmText += `\n• Связанные приглашения (${invitations.length}) **останутся в истории**`;
        }
        
        confirmText += `\n\n❓ Вы уверены что хотите продать этот автомобиль?`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💸 ДА, ПРОДАТЬ', callback_data: `confirm_sell_car_${carId}` }
                    ],
                    [
                        { text: '❌ Отменить', callback_data: `edit_car_${carId}` }
                    ]
                ]
            }
        };
        
        try {
            await bot.editMessageText(confirmText, {
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                ...keyboard
            });
        } catch (editError) {
            await bot.sendMessage(msg.chat.id, confirmText, {
                parse_mode: 'Markdown',
                ...keyboard
            });
        }
        
    } catch (error) {
        console.error('Ошибка показа подтверждения продажи авто:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка');
    }
}

// Функция продажи автомобиля
async function sellCarCompletely(msg, userId, carId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) return;
        
        // Получаем информацию об автомобиле перед продажей
        const cars = await db.getCarsByMemberId(member.id);
        const car = cars.find(c => c.id.toString() === carId.toString());
        
        if (!car) {
            bot.answerCallbackQuery(msg.id, '❌ Автомобиль не найден');
            return;
        }
        
        // Проверяем, что пользователь является владельцем
        if (car.member_id !== member.id) {
            bot.answerCallbackQuery(msg.id, '❌ Вы не являетесь владельцем этого автомобиля');
            return;
        }
        
        // Обновляем статус автомобиля на "продан" и убираем владельца
        try {
            const result = await db.updateCar(carId, { 
                status: 'продан',
                member_id: null
            });
            
            if (result.affectedRows > 0) {
                // Логируем продажу
                console.log(`💸 Автомобиль продан пользователем ${userId}:`);
                console.log(`   Авто: ${car.brand} ${car.model} (ID: ${carId})`);
                console.log(`   Бывший владелец: ${member.first_name} (ID: ${member.id})`);
                
                let successText = `✅ **Автомобиль успешно продан!**\n\n`;
                successText += `🚗 ${car.brand} ${car.model}`;
                if (car.reg_number) successText += ` (${car.reg_number})`;
                successText += `\n\n📊 **Результат продажи:**`;
                successText += `\n💸 Статус изменен на "продан"`;
                successText += `\n👤 Вы больше не являетесь владельцем`;
                successText += `\n📋 Автомобиль остался в базе клуба`;
                successText += `\n🔄 Новый владелец может добавить его себе`;
                
                // Проверяем, влияет ли это на статус пользователя
                const remainingCars = await db.getCarsByMemberId(member.id);
                const activeCarsCount = remainingCars.filter(c => c.status !== 'вышел' && c.status !== 'продан').length;
                
                if (activeCarsCount === 0 && member.status === 'участник') {
                    // Если у участника не осталось автомобилей, меняем статус на "без авто"
                    await db.updateMemberStatus(userId, 'без авто');
                    successText += `\n\n📊 **Изменение статуса:**`;
                    successText += `\n⚪ Ваш статус изменен на "без авто"`;
                    successText += `\n💡 У вас не осталось активных автомобилей`;
                    
                    console.log(`📊 Статус пользователя ${member.first_name} изменен: участник → без авто (продал последний автомобиль)`);
                }
                
                successText += `\n\n🔄 Возвращаемся к списку автомобилей...`;
                
                const successKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚗 Мои автомобили', callback_data: 'my_cars' }],
                            [{ text: '➕ Добавить автомобиль', callback_data: 'add_car' }],
                            [{ text: '📋 Главное меню', callback_data: 'menu' }]
                        ]
                    }
                };
                
                bot.sendMessage(msg.chat.id, successText, {
                    parse_mode: 'Markdown',
                    ...successKeyboard
                });
                
            } else {
                bot.sendMessage(msg.chat.id, '❌ Ошибка продажи автомобиля');
            }
            
        } catch (dbError) {
            console.error('Ошибка продажи автомобиля в БД:', dbError);
            bot.sendMessage(msg.chat.id, '❌ Ошибка продажи автомобиля в базе данных');
        }
        
    } catch (error) {
        console.error('Ошибка продажи автомобиля:', error);
        bot.answerCallbackQuery(msg.id, '❌ Произошла ошибка при продаже');
    }
}

// Вспомогательная функция для получения отображаемого имени поля
function getFieldDisplayName(fieldName) {
    const fieldNames = {
        'brand': 'Марка',
        'model': 'Модель', 
        'generation': 'Поколение',
        'year': 'Год',
        'reg_number': 'Номер',
        'color': 'Цвет',
        'description': 'Описание'
    };
    return fieldNames[fieldName] || fieldName;
}

// =====================================================
// 🎉 Функции для работы с событиями
// =====================================================

async function showAllEvents(msg, userId) {
    try {
        const events = await db.getAllEvents();
        
        if (events.length === 0) {
            const noEventsKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Создать событие', callback_data: 'create_event' }],
                        [{ text: '🔙 Назад к событиям', callback_data: 'events_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '📅 События клуба\n\n' +
                '🎯 В данный момент нет запланированных событий.\n\n' +
                '✨ Станьте первым организатором и создайте интересное мероприятие для клуба!',
                { 
                    parse_mode: 'Markdown',
                    ...noEventsKeyboard 
                }
            );
            return;
        }
        
        // Показываем события по одному
        for (let i = 0; i < Math.min(events.length, 5); i++) {
            const event = events[i];
            
            let eventText = `🎉 **${event.title}**\n\n`;
            eventText += `📅 Дата: ${event.event_date}`;
            if (event.event_time) eventText += ` в ${event.event_time.substring(0, 5)}`;
            eventText += `\n📍 Место: ${event.location}, ${event.city}`;
            eventText += `\n🎯 Тип: ${event.type}`;
            eventText += `\n📊 Статус: ${event.status}`;
            
            if (event.first_name) {
                eventText += `\n👤 Организатор: ${event.first_name}`;
                if (event.last_name) eventText += ` ${event.last_name}`;
            }
            
            if (event.participants_count > 0) {
                eventText += `\n👥 Участников: ${event.participants_count}`;
                if (event.max_participants) eventText += `/${event.max_participants}`;
            }
            
            if (event.price > 0) {
                eventText += `\n💰 Стоимость: ${event.price}₽`;
            } else {
                eventText += `\n🆓 Бесплатно`;
            }
            
            if (event.description) {
                eventText += `\n\n💭 ${event.description}`;
            }
            
            const eventKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Подробнее', callback_data: `event_details_${event.id}` }]
                    ]
                }
            };
            
            await bot.sendMessage(msg.chat.id, eventText, {
                parse_mode: 'Markdown',
                ...eventKeyboard
            });
            
            // Небольшая задержка между сообщениями
            if (i < Math.min(events.length, 5) - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Кнопки навигации
        const navigationKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Создать событие', callback_data: 'create_event' }],
                    [{ text: '🔙 Назад к событиям', callback_data: 'events_menu' }]
                ]
            }
        };
        
        const summaryText = events.length > 5 ? 
            `📊 Показано 5 из ${events.length} событий` : 
            `📊 Всего событий: ${events.length}`;
        
        bot.sendMessage(msg.chat.id, summaryText, navigationKeyboard);
        
    } catch (error) {
        console.error('Ошибка показа событий:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки событий');
    }
}

async function showAllServices(msg, userId) {
    try {
        const services = await db.getAllServices();
        
        if (services.length === 0) {
            const noServicesKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Добавить сервис', callback_data: 'add_service' }],
                        [{ text: '🔙 Назад к сервисам', callback_data: 'services_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(msg.chat.id, 
                '🔧 Каталог сервисов\n\n' +
                '🏪 В каталоге пока нет автосервисов.\n\n' +
                '✨ Помогите клубу и добавьте первый проверенный сервис!',
                { 
                    parse_mode: 'Markdown',
                    ...noServicesKeyboard 
                }
            );
            return;
        }
        
        // Показываем сервисы по одному
        for (let i = 0; i < Math.min(services.length, 5); i++) {
            const service = services[i];
            
            let serviceText = `🏪 **${service.name}**\n\n`;
            serviceText += `🔧 Тип: ${service.type}`;
            serviceText += `\n🏙️ Город: ${service.city}`;
            
            if (service.address) serviceText += `\n📍 Адрес: ${service.address}`;
            if (service.phone) serviceText += `\n📱 Телефон: ${service.phone}`;
            if (service.website) serviceText += `\n🌐 Сайт: ${service.website}`;
            
            // Рейтинг и рекомендация
            if (service.rating) {
                serviceText += `\n⭐ Рейтинг: ${service.rating}/5.0`;
                if (service.reviews_count > 0) {
                    serviceText += ` (${service.reviews_count} отзывов)`;
                }
            }
            
            const recommendationEmoji = {
                'рекомендуется': '✅',
                'не рекомендуется': '❌',
                'нейтрально': '⚪'
            };
            
            serviceText += `\n${recommendationEmoji[service.recommendation] || '⚪'} ${service.recommendation}`;
            
            if (service.price_range) {
                const priceEmoji = {
                    'низкий': '💚',
                    'средний': '💛', 
                    'высокий': '🔴'
                };
                serviceText += `\n💰 Цены: ${priceEmoji[service.price_range]} ${service.price_range}`;
            }
            
            if (service.working_hours) {
                serviceText += `\n🕒 Часы работы: ${service.working_hours}`;
            }
            
            if (service.description) {
                serviceText += `\n\n💭 ${service.description}`;
            }
            
            const serviceKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Подробнее', callback_data: `service_details_${service.id}` }]
                    ]
                }
            };
            
            await bot.sendMessage(msg.chat.id, serviceText, {
                parse_mode: 'Markdown',
                ...serviceKeyboard
            });
            
            // Небольшая задержка между сообщениями
            if (i < Math.min(services.length, 5) - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Кнопки навигации
        const navigationKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Добавить сервис', callback_data: 'add_service' }],
                    [{ text: '🔙 Назад к сервисам', callback_data: 'services_menu' }]
                ]
            }
        };
        
        const summaryText = services.length > 5 ? 
            `📊 Показано 5 из ${services.length} сервисов` : 
            `📊 Всего сервисов: ${services.length}`;
        
        bot.sendMessage(msg.chat.id, summaryText, navigationKeyboard);
        
    } catch (error) {
        console.error('Ошибка показа сервисов:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки сервисов');
    }
}

async function startCreateEvent(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы в клубе');
            return;
        }
        
        // Устанавливаем состояние создания события
        userStates.set(userId, {
            state: 'creating_event',
            step: 'title',
            data: { organizer_id: member.id }
        });
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отменить', callback_data: 'events_menu' }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            '🎉 Создание события\n\n' +
            '📝 Шаг 1 из 6: Название события\n\n' +
            'Придумайте яркое и понятное название для вашего мероприятия:\n\n' +
            '💡 Примеры: "Весенний заезд в Подмосковье", "Техническая встреча", "Фотосессия в центре"',
            { 
                parse_mode: 'Markdown',
                ...keyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка начала создания события:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка создания события');
    }
}

async function startAddService(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы в клубе');
            return;
        }
        
        // Устанавливаем состояние добавления сервиса
        userStates.set(userId, {
            state: 'adding_service',
            step: 'name',
            data: { added_by_member_id: member.id }
        });
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отменить', callback_data: 'services_menu' }]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            '🔧 Добавление сервиса\n\n' +
            '📝 Шаг 1 из 5: Название сервиса\n\n' +
            'Введите название автосервиса, который хотите добавить в каталог:\n\n' +
            '💡 Примеры: "Автосервис Кабрио Центр", "Детейлинг Блеск", "СТО Гараж 77"',
            { 
                parse_mode: 'Markdown',
                ...keyboard 
            }
        );
        
    } catch (error) {
        console.error('Ошибка начала добавления сервиса:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка добавления сервиса');
    }
}

// Инициализация бота
async function initBot() {
    try {
        // Проверяем обязательные переменные окружения
        if (!config.BOT_TOKEN) {
            console.error('❌ BOT_TOKEN не найден в .env файле!');
            process.exit(1);
        }
        
        if (!config.CHAT_ID) {
            console.error('❌ CHAT_ID не найден в .env файле!');
            console.log('📋 Как получить CHAT_ID:');
            console.log('1. Добавьте бота в группу');
            console.log('2. Напишите любое сообщение в группе');
            console.log(`3. Перейдите: https://api.telegram.org/bot${config.BOT_TOKEN}/getUpdates`);
            console.log('4. Найдите "chat":{"id":-1001234567890} и скопируйте число в .env');
            process.exit(1);
        }
        
        createUploadDirs();
        
        // Устанавливаем команды бота
        const commands = [
            { command: 'start', description: '🚀 Запуск бота и приветствие' },
            { command: 'menu', description: '📋 Главное меню с кнопками' },
            { command: 'register', description: '📝 Регистрация в клубе' },
            { command: 'profile', description: '👤 Мой профиль' },
            { command: 'cars', description: '🚗 Мои автомобили' },
            { command: 'addcar', description: '➕ Добавить автомобиль' },
            { command: 'invite', description: '🎯 Создать приглашение' },
            { command: 'myinvites', description: '📮 Мои приглашения' },
            { command: 'search', description: '🔍 Поиск по номеру' },
            { command: 'stats', description: '📊 Статистика клуба' },
            { command: 'status', description: '🔧 Системная диагностика (админы)' },
            { command: 'admintest', description: '🔐 Тест админских прав (админы)' },
            { command: 'authlogs', description: '📊 Логи авторизации сайта (админы)' },

            { command: 'setuserstatus', description: '🔧 Изменить статус пользователя (админы)' },
            { command: 'setpass', description: '🔐 Установить пароль для получения активного статуса (админы)' },
            { command: 'cancel', description: '❌ Отменить текущую операцию' },
            { command: 'help', description: '❓ Справка по командам' }
        ];
        
        await bot.setMyCommands(commands);
        console.log('✅ Команды бота установлены');
        
        console.log('🤖 Telegram бот запущен!');
        console.log(`📱 Имя бота: ${(await bot.getMe()).first_name}`);
        console.log(`🆔 Chat ID для проверки: ${config.CHAT_ID}`);
        console.log(`🗄️ База данных: ${config.DATABASE.host}/${config.DATABASE.database}`);
        
        // Проверяем права бота в группе
        try {
            const botMember = await bot.getChatMember(config.CHAT_ID, (await bot.getMe()).id);
            console.log(`🔐 Статус бота в группе: ${botMember.status}`);
            
            if (botMember.status === 'administrator') {
                console.log('✅ Бот является администратором группы');
            } else if (botMember.status === 'member') {
                console.log('⚠️ Бот является обычным участником (может быть ограничен в правах)');
            } else {
                console.log('❌ Бот не является участником группы');
            }
        } catch (error) {
            console.error('❌ Ошибка проверки статуса бота в группе:', error.message);
        }
        
        // Запуск веб API
        const apiApp = createAPI();
        const PORT = 3001;
        apiApp.listen(PORT, () => {
            console.log(`🌐 Веб API запущен на http://localhost:${PORT}`);
            console.log(`📊 Дашборд доступен: http://localhost:${PORT}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка инициализации бота:', error);
        process.exit(1);
    }
}

// Обработка ошибок
bot.on('error', (error) => {
    console.error('❌ Ошибка бота:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Завершение работы бота...');
    await db.close();
    process.exit(0);
});

// Запуск бота
initBot(); 
