const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const db = require('../database/database');

// Создаём экземпляр бота
const bot = new TelegramBot(config.BOT_TOKEN, { 
    polling: true,
    // Подавляем deprecation warning для отправки файлов
    filepath: false
});

// Состояния пользователей для многошаговых операций
const userStates = new Map();

// Функции для уведомлений в группу
async function sendGroupNotification(message, options = {}) {
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
    }
}

async function sendGroupPhoto(photoPath, caption, options = {}) {
    try {
        console.log('📸 Отправляем фото в группу:', photoPath);
        
        // Проверяем, является ли photoPath файлом или URL
        let photoSource;
        if (photoPath && photoPath.startsWith('http')) {
            // Это URL
            photoSource = photoPath;
            console.log('📡 Используем URL для фото');
        } else {
            // Это локальный файл
            if (!photoPath || !fs.existsSync(photoPath)) {
                console.error('❌ Файл не найден:', photoPath);
                // Отправляем только текст без фото
                await sendGroupNotification(caption, options);
                return;
            }
            
            photoSource = fs.createReadStream(photoPath);
            console.log('📁 Используем локальный файл');
        }
        
        await bot.sendPhoto(config.CHAT_ID, photoSource, {
            caption: caption,
            parse_mode: 'Markdown',
            contentType: 'image/jpeg',
            ...options
        });
        
        console.log('✅ Фото отправлено успешно');
    } catch (error) {
        console.error('❌ Ошибка отправки фото в группу:', error);
        console.error('Путь к фото:', photoPath);
        console.error('Детали ошибки:', error.message);
        
        // Если не удалось отправить фото, отправляем только текст
        try {
            await sendGroupNotification(caption, options);
            console.log('✅ Отправлено текстовое уведомление вместо фото');
        } catch (fallbackError) {
            console.error('❌ Ошибка отправки резервного уведомления:', fallbackError);
        }
    }
}

// Проверка членства в чате
async function checkChatMembership(userId) {
    try {
        const member = await bot.getChatMember(config.CHAT_ID, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        console.error('Ошибка проверки членства в чате:', error);
        return false;
    }
}

// Middleware для проверки доступа
async function checkAccess(msg) {
    const userId = msg.from.id;
    const isMember = await checkChatMembership(userId);
    
    if (!isMember) {
        bot.sendMessage(msg.chat.id, 
            '❌ *Доступ запрещён!*\n\n' +
            'Этот бот доступен только участникам клуба кабриолетов.\n\n' +
            '🚗 Присоединяйтесь к нашей группе:\n' +
            `👥 [${config.CLUB.groupLink}](${config.CLUB.groupLink})\n\n` +
            'После вступления в группу все функции бота станут доступны!',
            { parse_mode: 'Markdown' }
        );
        return false;
    }
    
    return true;
}

// Создание директорий для загрузки файлов
function createUploadDirs() {
    const path = require('path');
    const dirs = [
        path.join(__dirname, '../../uploads/members'),
        path.join(__dirname, '../../uploads/cars')
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log('✅ Создана директория:', dir);
        }
    });
}

// Команда /start
bot.onText(/\/start/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    
    try {
        // Проверяем, есть ли пользователь в базе
        const existingMember = await db.getMemberByTelegramId(userId);
        
        if (existingMember) {
            bot.sendMessage(msg.chat.id, 
                `👋 С возвращением, ${existingMember.first_name}!\n\n` +
                `Статус: ${existingMember.status}\n` +
                `Дата вступления: ${existingMember.join_date}\n\n` +
                'Используйте /menu для просмотра доступных команд.'
            );
        } else {
            bot.sendMessage(msg.chat.id, 
                `🚗 ${config.CLUB.welcomeMessage}\n\n` +
                `Привет, ${firstName}! Я вижу, что ты новый участник.\n` +
                'Давайте зарегистрируем тебя в нашей базе.\n\n' +
                'Используй /register для регистрации.'
            );
        }
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        bot.sendMessage(msg.chat.id, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Команда /menu
bot.onText(/\/menu/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                // Личный кабинет
                [
                    { text: '👤 Мой профиль', callback_data: 'my_profile' },
                    { text: '🚗 Мои авто', callback_data: 'my_cars' }
                ],
                [
                    { text: '📝 Добавить авто', callback_data: 'add_car' }
                ],
                // Активности клуба
                [
                    { text: '🎯 Оставить приглашение', callback_data: 'create_invitation' },
                    { text: '🔍 Поиск авто', callback_data: 'search_by_number' }
                ],
                [
                    { text: '📮 Мои приглашения', callback_data: 'my_invitations' }
                ],
                // Информация
                [
                    { text: '📊 Статистика клуба', callback_data: 'stats' },
                    { text: '❓ Помощь', callback_data: 'help' }
                ]
            ]
        }
    };
    
    bot.sendMessage(msg.chat.id, 
        '🚗 *Главное меню Cabrio Club*\n\n' +
        '👤 **Личный кабинет:**\n' +
        '• Профиль и автомобили\n\n' +
        '🎯 **Активности клуба:**\n' +
        '• Приглашения и поиск\n\n' +
        '📊 **Информация:**\n' +
        '• Статистика и помощь\n\n' +
        '👇 *Выберите нужный раздел:*', 
        { parse_mode: 'Markdown', ...keyboard }
    );
});

// Команда /register
bot.onText(/\/register/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    const userId = msg.from.id;
    
    try {
        const existingMember = await db.getMemberByTelegramId(userId);
        
        if (existingMember) {
            bot.sendMessage(msg.chat.id, '✅ Вы уже зарегистрированы в системе!');
            return;
        }
        
        // Начинаем процесс регистрации
        userStates.set(userId, { state: 'registering', step: 'name' });
        
        bot.sendMessage(msg.chat.id, 
            '📝 *Регистрация в Cabrio Club*\n\n' +
            'Как вас зовут? (введите ваше имя)',
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка регистрации. Попробуйте позже.');
    }
});

// Команда /skip
bot.onText(/\/skip/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, '❌ Нет активного процесса для пропуска.');
        return;
    }
    
    // Обрабатываем как обычное сообщение с текстом "/skip"
    if (userState.state === 'registering') {
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
    await showHelp(msg);
});

// Команда /done
bot.onText(/\/done/, async (msg) => {
    if (!await checkAccess(msg)) return;
    
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
    await startSearchByNumber(msg, msg.from.id);
});

// Команда /invite - создать приглашение
bot.onText(/\/invite/, async (msg) => {
    if (!await checkAccess(msg)) return;
    await startCreateInvitation(msg, msg.from.id);
});

// Команда /myinvites - мои приглашения
bot.onText(/\/myinvites/, async (msg) => {
    if (!await checkAccess(msg)) return;
    await showUserInvitations(msg, msg.from.id);
});

// Команда /addcar - добавить автомобиль
bot.onText(/\/addcar/, async (msg) => {
    if (!await checkAccess(msg)) return;
    await startAddCar(msg, msg.from.id);
});

// Команда /profile - мой профиль
bot.onText(/\/profile/, async (msg) => {
    if (!await checkAccess(msg)) return;
    await showUserProfile(msg, msg.from.id);
});

// Команда /cars - мои автомобили
bot.onText(/\/cars/, async (msg) => {
    if (!await checkAccess(msg)) return;
    await showUserCars(msg, msg.from.id);
});

// Команда /stats - статистика клуба
bot.onText(/\/stats/, async (msg) => {
    if (!await checkAccess(msg)) return;
    await showStats(msg);
});

// Обработка callback запросов
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;
    
    if (!await checkChatMembership(userId)) {
        bot.answerCallbackQuery(callbackQuery.id, '❌ Доступ запрещён');
        return;
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
                
            case 'help':
                await showHelp(msg);
                break;
                
            case 'search_by_number':
                await startSearchByNumber(msg, userId);
                break;
                
            case 'menu':
            case 'back_to_menu':
                // Показываем главное меню
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            // Личный кабинет
                            [
                                { text: '👤 Мой профиль', callback_data: 'my_profile' },
                                { text: '🚗 Мои авто', callback_data: 'my_cars' }
                            ],
                            [
                                { text: '📝 Добавить авто', callback_data: 'add_car' }
                            ],
                            // Активности клуба
                            [
                                { text: '🎯 Оставить приглашение', callback_data: 'create_invitation' },
                                { text: '🔍 Поиск авто', callback_data: 'search_by_number' }
                            ],
                            [
                                { text: '📮 Мои приглашения', callback_data: 'my_invitations' }
                            ],
                            // Информация
                            [
                                { text: '📊 Статистика клуба', callback_data: 'stats' },
                                { text: '❓ Помощь', callback_data: 'help' }
                            ]
                        ]
                    }
                };
                
                bot.editMessageText(
                    '🚗 *Главное меню Cabrio Club*\n\n' +
                    '👤 **Личный кабинет:**\n' +
                    '• Профиль и автомобили\n\n' +
                    '🎯 **Активности клуба:**\n' +
                    '• Приглашения и поиск\n\n' +
                    '📊 **Информация:**\n' +
                    '• Статистика и помощь\n\n' +
                    '👇 *Выберите нужный раздел:*', 
                    {
                        chat_id: msg.chat.id,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...keyboard
                    }
                );
                break;
                
            case 'edit_profile':
                bot.sendMessage(msg.chat.id, 
                    '✏️ *Редактирование профиля*\n\n' +
                    'Функция редактирования профиля находится в разработке.\n\n' +
                    'Пока что для изменения данных обратитесь к администратору клуба.\n\n' +
                    '🔧 *Планируемые возможности:*\n' +
                    '• Изменение имени и фамилии\n' +
                    '• Обновление города и страны\n' +
                    '• Изменение номера телефона\n' +
                    '• Редактирование описания\n' +
                    '• Загрузка нового фото\n\n' +
                    '📞 *Как связаться с администратором:*\n' +
                    '• Напишите в группе [Cabrio Club](https://t.me/Cabrio_Ride)\n' +
                    '• Обратитесь к модераторам группы',
                    { parse_mode: 'Markdown' }
                );
                break;
                
            default:
                bot.answerCallbackQuery(callbackQuery.id, '❓ Неизвестная команда');
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
                const welcomeMessage = `🤖 *Привет всем!*\n\n` +
                    `Я бот клуба кабриолетов! 🚗💨\n\n` +
                    `**Мои функции:**\n` +
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
                const wrongGroupMessage = `🤖 *Привет!*\n\n` +
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
        
        console.log('🔍 Отладка new_chat_members:');
        console.log('Chat ID из события:', chat.id);
        console.log('Chat ID из config:', config.CHAT_ID);
        console.log('Сравнение:', chat.id.toString(), '===', config.CHAT_ID.toString());
        
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
                
                // Восстанавливаем статус участника
                await db.updateMember(newMember.id, { 
                    status: 'активный',
                    left_date: null // Убираем дату выхода
                });
                
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
                
                // Отправляем сообщение о возвращении
                const returnMessage = `🎊 *Участник вернулся в клуб!*\n\n` +
                    `${firstName}${username ? ` (${username})` : ''} снова с нами!\n\n` +
                    `🚗 Восстановлено автомобилей: ${restoredCarsCount}\n\n` +
                    `📊 Статистика обновлена\n\n` +
                    `Добро пожаловать обратно! 🤗`;
                
                await sendGroupNotification(returnMessage);
                console.log('✅ Уведомление о возвращении отправлено');
                
            } else if (existingMember) {
                // Участник уже есть в БД с другим статусом
                console.log('ℹ️ Участник уже зарегистрирован со статусом:', existingMember.status);
                
                const infoMessage = `👋 *Участник вернулся в группу*\n\n` +
                    `${firstName}${username ? ` (${username})` : ''} снова в чате!\n\n` +
                    `Статус в клубе: ${existingMember.status}`;
                
                await sendGroupNotification(infoMessage);
                
            } else {
                // Новый участник
                console.log('👤 Приветствуем нового участника:', firstName);
                
                const welcomeMessage = `🎉 *Добро пожаловать в клуб кабриолетов!*\n\n` +
                    `Привет, ${firstName}${username ? ` (${username})` : ''}!\n\n` +
                    `🚗 Рады видеть нового любителя кабриолетов в нашем клубе!\n\n` +
                    `Для начала работы напишите боту [${config.CLUB.botLink}](${config.CLUB.botLink}) в личные сообщения и используйте команду start\n\n` +
                    `Если есть вопросы - обращайтесь к администраторам! 👋`;
                
                await sendGroupNotification(welcomeMessage);
                console.log('✅ Приветственное сообщение отправлено');
            }
        }
    } catch (error) {
        console.error('Ошибка приветствия новых участников:', error);
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
            
            const farewellMessage = `😔 *Участник покинул клуб*\n\n` +
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
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы. Используйте /register');
            return;
        }
        
        let profileText = `👤 *Ваш профиль*\n\n`;
        profileText += `**Имя:** ${member.first_name}`;
        if (member.last_name) profileText += ` ${member.last_name}`;
        profileText += `\n**Статус:** ${member.status}`;
        profileText += `\n**Дата вступления:** ${member.join_date}`;
        if (member.left_date) profileText += `\n**Дата выхода:** ${member.left_date}`;
        
        if (member.nickname) profileText += `\n**Никнейм:** ${member.nickname}`;
        if (member.alias) profileText += `\n**Позывной:** ${member.alias}`;
        if (member.city) profileText += `\n**Город:** ${member.city}`;
        if (member.country) profileText += `\n**Страна:** ${member.country}`;
        if (member.phone) profileText += `\n**Телефон:** ${member.phone}`;
        if (member.about) profileText += `\n\n**О себе:** ${member.about}`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Редактировать профиль', callback_data: 'edit_profile' }],
                    [{ text: '🔙 Назад в меню', callback_data: 'back_to_menu' }]
                ]
            }
        };
        
        // Если есть фото профиля, отправляем с фото
        if (member.photo_url && member.photo_url.trim() !== '') {
            try {
                const fs = require('fs');
                const path = require('path');
                const photoPath = path.join(__dirname, '../../uploads/members', member.photo_url);
                
                if (fs.existsSync(photoPath)) {
                    await bot.sendPhoto(msg.chat.id, photoPath, {
                        caption: profileText,
                        parse_mode: 'Markdown',
                        ...keyboard
                    });
                } else {
                    // Если файл не найден, отправляем текст
                    bot.sendMessage(msg.chat.id, profileText + '\n\n📷 *Фото профиля не найдено*', { 
                        parse_mode: 'Markdown', 
                        ...keyboard 
                    });
                }
            } catch (error) {
                console.error('Ошибка отправки фото профиля:', error);
                bot.sendMessage(msg.chat.id, profileText + '\n\n📷 *Ошибка загрузки фото*', { 
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
        const member = await db.getMemberByTelegramId(userId);
        
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы');
            return;
        }
        
        const cars = await db.getCarsByMemberId(member.id);
        
        if (cars.length === 0) {
            bot.sendMessage(msg.chat.id, 
                '🚗 У вас пока нет добавленных автомобилей.\n\n' +
                'Используйте кнопку "📝 Добавить авто" для добавления первого автомобиля.'
            );
            return;
        }
        
        // Отправляем каждый автомобиль отдельным сообщением с фото
        for (let i = 0; i < cars.length; i++) {
            const car = cars[i];
            
            let carText = `🚗 *Автомобиль ${i + 1} из ${cars.length}*\n\n`;
            carText += `**${car.brand} ${car.model}**`;
            if (car.generation) carText += ` (${car.generation})`;
            carText += `\n📅 Год: ${car.year}`;
            if (car.reg_number) carText += `\n🔢 Номер: ${car.reg_number}`;
            if (car.color) carText += `\n🎨 Цвет: ${car.color}`;
            carText += `\n📊 Статус: ${car.status}`;
            if (car.description) carText += `\n💭 ${car.description}`;
            
            // Проверяем наличие фотографий
            if (car.photos && car.photos.trim() !== '') {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const photos = JSON.parse(car.photos);
                    
                    if (photos && photos.length > 0) {
                        // Берем первое фото для отображения
                        const firstPhoto = photos[0];
                        const photoPath = path.join(__dirname, '../../uploads/cars', firstPhoto);
                        
                        if (fs.existsSync(photoPath)) {
                            if (photos.length > 1) {
                                carText += `\n📷 Фото: 1 из ${photos.length}`;
                            }
                            
                            await bot.sendPhoto(msg.chat.id, photoPath, {
                                caption: carText,
                                parse_mode: 'Markdown'
                            });
                        } else {
                            carText += `\n📷 *Фото не найдено*`;
                            await bot.sendMessage(msg.chat.id, carText, { parse_mode: 'Markdown' });
                        }
                    } else {
                        await bot.sendMessage(msg.chat.id, carText, { parse_mode: 'Markdown' });
                    }
                } catch (error) {
                    console.error('Ошибка отправки фото автомобиля:', error);
                    carText += `\n📷 *Ошибка загрузки фото*`;
                    await bot.sendMessage(msg.chat.id, carText, { parse_mode: 'Markdown' });
                }
            } else {
                await bot.sendMessage(msg.chat.id, carText, { parse_mode: 'Markdown' });
            }
            
            // Небольшая задержка между сообщениями
            if (i < cars.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
    } catch (error) {
        console.error('Ошибка показа автомобилей:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки автомобилей');
    }
}

// Функция показа статистики
async function showStats(msg) {
    try {
        const stats = await db.getStats();
        
        const statsText = `📊 *Статистика клуба*\n\n` +
            `👥 Участников в клубе: **${stats.totalMembers}**\n` +
            `✅ Активных участников: **${stats.activeMembers}**\n` +
            `🚗 Автомобилей в клубе: **${stats.totalCars}**\n` +
            `📮 Всего приглашений: **${stats.totalInvitations}**\n` +
            `🎯 Успешных приглашений: **${stats.successfulInvitations}**\n\n` +
            `📈 Конверсия: **${stats.totalInvitations > 0 ? 
                Math.round((stats.successfulInvitations / stats.totalInvitations) * 100) : 0}%**\n\n` +
            `👋 Вышло из клуба: **${stats.leftMembers}** участников\n` +
            `🚗 Авто вышедших: **${stats.leftCars}**`;
        
        bot.sendMessage(msg.chat.id, statsText, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Ошибка показа статистики:', error);
        bot.sendMessage(msg.chat.id, '❌ Ошибка загрузки статистики');
    }
}

// Функция показа помощи
async function showHelp(msg) {
    const helpText = `❓ *Помощь по использованию бота*\n\n` +
        `**🚀 Основные команды:**\n` +
        `/start - Запуск бота и приветствие\n` +
        `/menu - Главное меню с кнопками\n` +
        `/register - Регистрация в клубе\n` +
        `/help - Эта справка\n\n` +
        `**👤 Профиль и автомобили:**\n` +
        `/profile - Мой профиль\n` +
        `/cars - Мои автомобили\n` +
        `/addcar - Добавить автомобиль\n\n` +
        `**🎯 Приглашения:**\n` +
        `/invite - Создать приглашение\n` +
        `/myinvites - Мои приглашения\n` +
        `/search - Поиск по номеру\n\n` +
        `**📊 Информация:**\n` +
        `/stats - Статистика клуба\n\n` +
        `**🔧 Служебные команды:**\n` +
        `/skip - Пропустить шаг (в процессах)\n` +
        `/done - Завершить загрузку фото\n\n` +
        `**💡 Совет:** Используйте /menu для удобного доступа ко всем функциям через кнопки!\n\n` +
        `**🆘 Поддержка:**\n` +
        `Если у вас возникли проблемы, обратитесь к администраторам в чате клуба.`;
    
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
}

// Обработка текстовых сообщений для многошаговых операций
bot.on('message', async (msg) => {
    // Игнорируем команды (они обрабатываются отдельно)
    if (msg.text && msg.text.startsWith('/')) return;
    
    // Проверяем доступ
    if (!await checkChatMembership(msg.from.id)) return;
    
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) return; // Нет активного состояния
    
    try {
        if (userState.state === 'registering') {
            await handleRegistration(msg, userId, userState);
        } else if (userState.state === 'adding_car') {
            await handleAddCar(msg, userId, userState);
        } else if (userState.state === 'creating_invitation') {
            await handleCreateInvitation(msg, userId, userState);
        } else if (userState.state === 'searching') {
            await handleSearch(msg, userId, userState);
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
        if (userState.state === 'registering') {
            await handlePhotoRegistration(msg, userId, userState);
        } else if (userState.state === 'adding_car') {
            await handleCarPhoto(msg, userId, userState);
        } else if (userState.state === 'creating_invitation') {
            await handleInvitationPhoto(msg, userId, userState);
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
            
            bot.sendMessage(msg.chat.id, 
                `Приятно познакомиться, ${data.first_name}! 👋\n\n` +
                'Введите вашу фамилию (или нажмите /skip если не хотите указывать):'
            );
            break;
            
        case 'last_name':
            if (msg.text.trim() !== '/skip') {
                data.last_name = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'city';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                'В каком городе вы живёте? 🏙️\n' +
                '(или нажмите /skip)'
            );
            break;
            
        case 'city':
            if (msg.text.trim() !== '/skip') {
                data.city = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'country';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                'В какой стране вы живёте? 🌍\n' +
                'Наш клуб базируется в Минске, Беларусь.\n' +
                'Примеры: Беларусь, Россия, Казахстан, Украина\n' +
                '(или нажмите /skip, по умолчанию будет "Беларусь")'
            );
            break;
            
        case 'country':
            if (msg.text.trim() !== '/skip') {
                data.country = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'phone';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                'Введите ваш номер телефона 📱\n' +
                'Например: +375 (33) 993-22-88\n' +
                '(или нажмите /skip)'
            );
            break;
            
        case 'phone':
            if (msg.text.trim() !== '/skip') {
                data.phone = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'about';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                'Расскажите немного о себе 📝\n' +
                'Какие у вас автомобили? Как давно увлекаетесь кабриолетами?\n' +
                '(или нажмите /skip)'
            );
            break;
            
        case 'about':
            if (msg.text.trim() !== '/skip') {
                data.about = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'photo';
            userStates.set(userId, userState);
            
            bot.sendMessage(msg.chat.id, 
                '📸 Загрузите ваше фото для профиля\n' +
                'Это поможет другим участникам узнать вас!\n\n' +
                '(или нажмите /skip если не хотите добавлять фото)'
            );
            break;
            
        case 'photo':
            if (msg.text && msg.text.trim() === '/skip') {
                // Пропускаем фото
                await completeRegistration(msg, userId, data);
            } else if (msg.text) {
                // Пользователь ввел текст вместо фото
                bot.sendMessage(msg.chat.id, 
                    '📸 Пожалуйста, отправьте фотографию или нажмите /skip'
                );
            }
            // Если это фото - оно обрабатывается в handlePhotoRegistration
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
        
        // Подготавливаем данные для сохранения
        const memberData = {
            telegram_id: userId,
            first_name: data.first_name,
            last_name: data.last_name || null,
            nickname: msg.from.username || null,
            alias: null, // Пока не собираем
            phone: data.phone || null,
            email: null, // Пока не собираем
            city: data.city || null,
            country: data.country || 'Беларусь', // По умолчанию Беларусь (клуб базируется в Минске)
            about: data.about || null,
            photo_url: data.photo_url || null,
            join_date: new Date().toISOString().split('T')[0], // Сегодняшняя дата
            status: 'новый'
        };
        
        // Сохраняем в базу данных
        const newMember = await db.createMember(memberData);
        
        // Удаляем состояние пользователя
        userStates.delete(userId);
        
        // Отправляем подтверждение
        let confirmationText = '🎉 *Регистрация завершена успешно!*\n\n';
        confirmationText += `👤 **Имя:** ${memberData.first_name}`;
        if (memberData.last_name) confirmationText += ` ${memberData.last_name}`;
        if (memberData.city) confirmationText += `\n🏙️ **Город:** ${memberData.city}`;
        if (memberData.country) confirmationText += `\n🌍 **Страна:** ${memberData.country}`;
        if (memberData.phone) confirmationText += `\n📱 **Телефон:** ${memberData.phone}`;
        confirmationText += `\n📅 **Дата вступления:** ${memberData.join_date}`;
        confirmationText += `\n📊 **Статус:** ${memberData.status}`;
        
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
        
        console.log(`✅ Новый участник зарегистрирован: ${memberData.first_name} (ID: ${userId})`);
        
        // Отправляем уведомление в группу о новой регистрации (но без автомобиля)
        let groupNotification = `👋 *Новый участник зарегистрировался!*\n\n`;
        groupNotification += `👤 **Имя:** ${memberData.first_name}`;
        if (memberData.last_name) groupNotification += ` ${memberData.last_name}`;
        if (memberData.nickname) groupNotification += ` (@${memberData.nickname})`;
        if (memberData.city) groupNotification += `\n🏙️ **Город:** ${memberData.city}`;
        if (memberData.country) groupNotification += `\n🌍 **Страна:** ${memberData.country}`;
        if (memberData.about) groupNotification += `\n\n💭 **О себе:** ${memberData.about}`;
        
        groupNotification += `\n\n🚗 *Ждём информацию об автомобилях!*`;
        
        // Отправляем фото профиля если есть
        if (memberData.photo_url) {
            const fs = require('fs');
            const path = require('path');
            const photoPath = path.join(__dirname, '../../uploads/members', memberData.photo_url);
            
            console.log('📸 Отладка фото регистрации:');
            console.log('memberData.photo_url:', memberData.photo_url);
            console.log('photoPath:', photoPath);
            console.log('fs.existsSync(photoPath):', fs.existsSync(photoPath));
            
            if (fs.existsSync(photoPath)) {
                console.log('✅ Отправляем фото профиля в группу');
                await sendGroupPhoto(photoPath, groupNotification);
            } else {
                console.log('⚠️ Файл фото профиля не найден:', photoPath);
                await sendGroupNotification(groupNotification);
            }
        } else {
            console.log('ℹ️ У участника нет фото профиля');
            await sendGroupNotification(groupNotification);
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
            bot.sendMessage(msg.chat.id, '❌ Вы не зарегистрированы');
            return;
        }
        
        const invitations = await db.getInvitationsByInviter(member.id);
        
        if (invitations.length === 0) {
            bot.sendMessage(msg.chat.id, 
                '📮 У вас пока нет приглашений.\n\n' +
                'Используйте кнопку "🎯 Оставить приглашение" когда увидите незнакомый кабриолет!'
            );
            return;
        }
        
        let invitationsText = `📮 *Ваши приглашения (${invitations.length})*\n\n`;
        
        invitations.forEach((invitation, index) => {
            invitationsText += `**${index + 1}.** ${invitation.brand} ${invitation.model}`;
            if (invitation.reg_number) invitationsText += ` (${invitation.reg_number})`;
            invitationsText += `\n📅 Дата: ${invitation.invitation_date}`;
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
        
        invitationsText += `📊 **Статистика:**\n`;
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
                        { text: '📋 Главное меню', callback_data: 'menu' }
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
    userStates.set(userId, { state: 'adding_car', step: 'brand' });
    bot.sendMessage(msg.chat.id, 
        '🚗 *Добавление нового автомобиля*\n\n' +
        'Введите марку автомобиля (например: BMW, Mercedes-Benz, Audi):',
        { parse_mode: 'Markdown' }
    );
}

async function startCreateInvitation(msg, userId) {
    try {
        const member = await db.getMemberByTelegramId(userId);
        if (!member) {
            bot.sendMessage(msg.chat.id, '❌ Сначала зарегистрируйтесь командой /register');
            return;
        }
        
        userStates.set(userId, { 
            state: 'creating_invitation', 
            step: 'reg_number',
            data: { inviter_member_id: member.id }
        });
        
        bot.sendMessage(msg.chat.id, 
            '🎯 *Создание приглашения*\n\n' +
            'Вы увидели незнакомый кабриолет и оставили визитку?\n' +
            'Давайте зафиксируем это!\n\n' +
            '🔢 *Введите регистрационный номер автомобиля:*\n' +
            'Формат: только цифры и латинские буквы без пробелов\n' +
            'Например: A123BC77, 1234AB199\n\n' +
            '⚠️ *Это обязательное поле!*',
            { parse_mode: 'Markdown' }
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
            
            bot.sendMessage(msg.chat.id, 
                `Год: ${data.year} ✅\n\n` +
                '🚗 Введите регистрационный номер автомобиля\n' +
                'Формат: только цифры и латинские буквы без пробелов\n' +
                'Например: A123BC77, 1234AB199\n\n' +
                '(или нажмите /skip если не хотите указывать)'
            );
            break;
            
        case 'reg_number':
            if (msg.text.trim() === '/skip') {
                // Пропускаем номер
                userState.data = data;
                userState.step = 'photos';
                userStates.set(userId, userState);
                
                bot.sendMessage(msg.chat.id, 
                    '📸 Теперь загрузите фотографии вашего автомобиля!\n' +
                    'Вы можете отправить несколько фото подряд.\n\n' +
                    'Когда закончите, нажмите /done или /skip если не хотите добавлять фото.'
                );
            } else {
                // Валидация номера
                const validation = validateRegNumber(msg.text);
                
                if (!validation.valid) {
                    bot.sendMessage(msg.chat.id, 
                        `❌ ${validation.error}\n\n` +
                        'Примеры правильных номеров:\n' +
                        '• A123BC77\n' +
                        '• 1234AB199\n' +
                        '• H001AA\n\n' +
                        'Попробуйте ещё раз или нажмите /skip:'
                    );
                    return;
                }
                
                data.reg_number = validation.number;
                userState.data = data;
                userState.step = 'photos';
                userStates.set(userId, userState);
                
                bot.sendMessage(msg.chat.id, 
                    `Номер: ${data.reg_number} ✅\n\n` +
                    '📸 Теперь загрузите фотографии вашего автомобиля!\n' +
                    'Вы можете отправить несколько фото подряд.\n\n' +
                    'Когда закончите, нажмите /done или /skip если не хотите добавлять фото.'
                );
            }
            break;
            
        case 'photos':
            if (msg.text && (msg.text.trim() === '/done' || msg.text.trim() === '/skip')) {
                // Завершаем добавление автомобиля
                await completeAddCar(msg, userId, data);
            } else if (msg.text) {
                // Пользователь отправил текст вместо фото - даем подсказку
                bot.sendMessage(msg.chat.id, 
                    '📸 Ожидается фотография автомобиля.\n\n' +
                    'Отправьте фото или используйте команды:\n' +
                    '• /done - завершить добавление\n' +
                    '• /skip - пропустить фотографии'
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
        
        const carData = {
            member_id: member.id,
            brand: data.brand,
            model: data.model,
            year: data.year,
            reg_number: data.reg_number || null,
            photos: data.photos ? JSON.stringify(data.photos) : null,
            status: 'активный'
        };
        
        const newCar = await db.createCar(carData);
        userStates.delete(userId);
        
        let confirmText = `🎉 *Автомобиль добавлен успешно!*\n\n` +
            `🚗 **${data.brand} ${data.model}**\n` +
            `📅 **Год:** ${data.year}\n`;
        
        if (data.reg_number) {
            confirmText += `🔢 **Номер:** ${data.reg_number}\n`;
        }
        
        confirmText += `📊 **Статус:** активный\n`;
        
        if (data.photos && data.photos.length > 0) {
            confirmText += `📸 **Фотографий:** ${data.photos.length}\n`;
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
        
        // Проверяем, это ли первый автомобиль участника
        const memberCars = await db.getCarsByMemberId(member.id);
        const isFirstCar = memberCars.length === 1; // Только что добавленный автомобиль
        
        if (isFirstCar) {
            // Это первый автомобиль - отправляем полное приветствие нового члена клуба
            let welcomeMessage = `🎉 *Новый член клуба!*\n\n`;
            welcomeMessage += `👤 **${member.first_name}`;
            if (member.last_name) welcomeMessage += ` ${member.last_name}`;
            welcomeMessage += `**`;
            if (member.nickname) welcomeMessage += ` (@${member.nickname})`;
            if (member.city) welcomeMessage += `\n🏙️ **Город:** ${member.city}`;
            if (member.about) welcomeMessage += `\n\n💭 **О себе:** ${member.about}`;
            
            welcomeMessage += `\n\n🚗 **Первый автомобиль:**\n`;
            welcomeMessage += `**${data.brand} ${data.model}** (${data.year})`;
            if (data.reg_number) welcomeMessage += `\n🔢 **Номер:** ${data.reg_number}`;
            if (data.photos && data.photos.length > 0) {
                welcomeMessage += `\n📸 **Фотографий:** ${data.photos.length}`;
            }
            
            welcomeMessage += `\n\n🎊 Теперь вы полноправный участник клуба!`;
            
            // Отправляем фото автомобиля если есть
            if (data.photos && data.photos.length > 0) {
                const fs = require('fs');
                const path = require('path');
                const carPhotoPath = path.join(__dirname, '../../uploads/cars', data.photos[0]);
                
                if (fs.existsSync(carPhotoPath)) {
                    await sendGroupPhoto(carPhotoPath, welcomeMessage);
                } else {
                    console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
                    await sendGroupNotification(welcomeMessage);
                }
            } else if (member.photo_url) {
                const fs = require('fs');
                const path = require('path');
                const memberPhotoPath = path.join(__dirname, '../../uploads/members', member.photo_url);
                
                if (fs.existsSync(memberPhotoPath)) {
                    await sendGroupPhoto(memberPhotoPath, welcomeMessage);
                } else {
                    console.log('⚠️ Файл фото профиля не найден:', memberPhotoPath);
                    await sendGroupNotification(welcomeMessage);
                }
            } else {
                await sendGroupNotification(welcomeMessage);
            }
        } else {
            // Это дополнительный автомобиль
            let carMessage = `🚗 *Новый автомобиль в клубе!*\n\n`;
            carMessage += `👤 **Владелец:** ${member.first_name}`;
            if (member.last_name) carMessage += ` ${member.last_name}`;
            if (member.nickname) carMessage += ` (@${member.nickname})`;
            
            carMessage += `\n\n🚗 **${data.brand} ${data.model}** (${data.year})`;
            if (data.reg_number) carMessage += `\n🔢 **Номер:** ${data.reg_number}`;
            if (data.photos && data.photos.length > 0) {
                carMessage += `\n📸 **Фотографий:** ${data.photos.length}`;
            }
            
            carMessage += `\n\n📊 **Всего автомобилей у участника:** ${memberCars.length}`;
            
            // Отправляем фото автомобиля если есть
            if (data.photos && data.photos.length > 0) {
                const fs = require('fs');
                const path = require('path');
                const carPhotoPath = path.join(__dirname, '../../uploads/cars', data.photos[0]);
                
                if (fs.existsSync(carPhotoPath)) {
                    await sendGroupPhoto(carPhotoPath, carMessage);
                } else {
                    console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
                    await sendGroupNotification(carMessage);
                }
            } else {
                await sendGroupNotification(carMessage);
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
                    '⚠️ *Номер обязателен!* Попробуйте ещё раз:',
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
                        
                        let memberCarText = `🚫 *Этот автомобиль принадлежит участнику клуба!*\n\n`;
                        memberCarText += `🔢 **Номер:** ${validation.number}\n`;
                        memberCarText += `🚗 **Автомобиль:** ${car.brand} ${car.model}`;
                        if (car.year) memberCarText += ` (${car.year})`;
                        memberCarText += `\n📊 **Статус:** ${car.status}\n`;
                        
                        if (owner) {
                            memberCarText += `👤 **Владелец:** ${owner.first_name}`;
                            if (owner.last_name) memberCarText += ` ${owner.last_name}`;
                            if (owner.nickname) memberCarText += ` (@${owner.nickname})`;
                            memberCarText += `\n`;
                        }
                        
                        if (car.photos) {
                            try {
                                const photos = JSON.parse(car.photos);
                                if (photos && photos.length > 0) {
                                    memberCarText += `📸 **Фотографий:** ${photos.length}\n`;
                                }
                            } catch (error) {
                                console.error('Ошибка парсинга фото:', error);
                            }
                        }
                        
                        memberCarText += '\n💡 *Совет:* Свяжитесь с владельцем через клуб или администратора.';
                        
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
                        
                        let duplicateText = `⚠️ *Автомобиль с номером ${validation.number} уже есть в приглашениях!*\n\n`;
                        duplicateText += `🚗 **Марка:** ${car.brand}\n`;
                        duplicateText += `🚗 **Модель:** ${car.model}\n`;
                        duplicateText += `📮 **Приглашений:** ${invitations.length}\n`;
                        
                        if (invitations.length > 0) {
                            const lastInvitation = invitations[0];
                            duplicateText += `📅 **Последнее:** ${lastInvitation.invitation_date}\n`;
                            duplicateText += `📍 **Место:** ${lastInvitation.location}\n`;
                        }
                        
                        if (car.photos) {
                            try {
                                const photos = JSON.parse(car.photos);
                                if (photos && photos.length > 0) {
                                    duplicateText += `📸 **Фотографий:** ${photos.length}\n`;
                                }
                            } catch (error) {
                                console.error('Ошибка парсинга фото:', error);
                            }
                        }
                        
                        duplicateText += '\n🤔 Хотите всё равно создать новое приглашение?\n';
                        duplicateText += '• Нажмите /continue для продолжения\n';
                        duplicateText += '• Или /cancel для отмены';
                        
                        userState.data = data;
                        userState.step = 'confirm_duplicate';
                        userStates.set(userId, userState);
                        
                        bot.sendMessage(msg.chat.id, duplicateText, { parse_mode: 'Markdown' });
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
            
            bot.sendMessage(msg.chat.id, 
                `🔢 Номер: ${data.reg_number} ✅\n\n` +
                '📸 *Сфотографируйте автомобиль*\n' +
                'Это поможет лучше идентифицировать автомобиль при повторной встрече.\n\n' +
                '• Отправьте одну или несколько фотографий\n' +
                '• /done - завершить загрузку фото\n' +
                '• /skip - пропустить все фото',
                { parse_mode: 'Markdown' }
            );
            break;
            
        case 'confirm_duplicate':
            if (msg.text.trim() === '/continue') {
                // Продолжаем создание приглашения
                userState.step = 'photos';
                userStates.set(userId, userState);
                
                bot.sendMessage(msg.chat.id, 
                    `🔢 Номер: ${data.reg_number} ✅\n\n` +
                    '📸 *Сфотографируйте автомобиль*\n' +
                    'Это поможет лучше идентифицировать автомобиль при повторной встрече.\n\n' +
                    '• Отправьте одну или несколько фотографий\n' +
                    '• /done - завершить загрузку фото\n' +
                    '• /skip - пропустить все фото',
                    { parse_mode: 'Markdown' }
                );
            } else if (msg.text.trim() === '/cancel') {
                // Отменяем создание приглашения
                userStates.delete(userId);
                bot.sendMessage(msg.chat.id, 
                    '❌ Создание приглашения отменено.\n\n' +
                    'Используйте /menu для доступа к функциям.'
                );
            } else {
                bot.sendMessage(msg.chat.id, 
                    '🤔 Пожалуйста, выберите:\n' +
                    '• /continue - продолжить создание приглашения\n' +
                    '• /cancel - отменить'
                );
            }
            break;
            
        case 'location':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            if (msg.text.trim() !== '/skip') {
                data.location = msg.text.trim();
            }
            
            userState.data = data;
            userState.step = 'brand';
            userStates.set(userId, userState);
            
            let locationText = '';
            if (data.location) {
                locationText += `📍 Место: ${data.location} ✅\n\n`;
            }
            locationText += '🚗 *Марка автомобиля (необязательно)*\n';
            locationText += 'Если знаете марку, введите её:\n';
            locationText += 'Например: BMW, Mercedes-Benz, Audi, Porsche\n\n';
            locationText += '• /skip - пропустить этот вопрос\n';
            locationText += '• /finish - завершить приглашение';
            
            bot.sendMessage(msg.chat.id, locationText, { parse_mode: 'Markdown' });
            break;
            
        case 'photos':
            if (msg.text && (msg.text.trim() === '/skip')) {
                // Переходим к следующему этапу без фото
                userState.step = 'location';
                userStates.set(userId, userState);
                
                bot.sendMessage(msg.chat.id, 
                    '📍 *Где вы оставили визитку? (необязательно)*\n' +
                    'Например: "Парковка ТЦ Галерея", "ул. Ленина 15", "возле дома"\n\n' +
                    '• Введите место\n' +
                    '• /skip - пропустить этот вопрос\n' +
                    '• /finish - завершить приглашение',
                    { parse_mode: 'Markdown' }
                );
            } else if (msg.text && (msg.text.trim() === '/done')) {
                // Завершаем загрузку фото и переходим к следующему этапу
                const photoCount = data.photos ? data.photos.length : 0;
                
                if (photoCount === 0) {
                    bot.sendMessage(msg.chat.id, 
                        '📸 Вы не загрузили ни одного фото.\n' +
                        'Отправьте фотографию или нажмите /skip для пропуска.'
                    );
                    return;
                }
                
                userState.step = 'location';
                userStates.set(userId, userState);
                
                bot.sendMessage(msg.chat.id, 
                    `📸 Загружено фотографий: ${photoCount} ✅\n\n` +
                    '📍 *Где вы оставили визитку? (необязательно)*\n' +
                    'Например: "Парковка ТЦ Галерея", "ул. Ленина 15", "возле дома"\n\n' +
                    '• Введите место\n' +
                    '• /skip - пропустить этот вопрос\n' +
                    '• /finish - завершить приглашение',
                    { parse_mode: 'Markdown' }
                );
            } else {
                // Неизвестная команда на этапе фото
                bot.sendMessage(msg.chat.id, 
                    '❓ Неизвестная команда.\n\n' +
                    '📸 Отправьте фотографию автомобиля или используйте команды:\n' +
                    '• /done - завершить загрузку фото\n' +
                    '• /skip - пропустить все фото'
                );
            }
            break;
            
        case 'brand':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            if (msg.text.trim() !== '/skip') {
                data.brand = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'model';
            userStates.set(userId, userState);
            
            let brandText = '';
            if (data.brand) {
                brandText += `🚗 Марка: ${data.brand} ✅\n\n`;
            }
            brandText += '🚗 *Модель автомобиля (необязательно)*\n';
            brandText += 'Если знаете модель, введите её:\n';
            brandText += 'Например: E46, SLK, A4, 911\n\n';
            brandText += '• /skip - пропустить этот вопрос\n';
            brandText += '• /finish - завершить приглашение';
            
            bot.sendMessage(msg.chat.id, brandText, { parse_mode: 'Markdown' });
            break;
            
        case 'model':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            if (msg.text.trim() !== '/skip') {
                data.model = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'contact_info';
            userStates.set(userId, userState);
            
            let modelText = '';
            if (data.model) {
                modelText += `🚗 Модель: ${data.model} ✅\n\n`;
            }
            modelText += '📱 *Контакты в визитке (необязательно)*\n';
            modelText += 'Какие контакты вы оставили?\n';
            modelText += 'Например: "Telegram @username", "+7 999 123-45-67", "Иван Петров"\n\n';
            modelText += '• /skip - пропустить этот вопрос\n';
            modelText += '• /finish - завершить приглашение';
            
            bot.sendMessage(msg.chat.id, modelText, { parse_mode: 'Markdown' });
            break;
            
        case 'contact_info':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            if (msg.text.trim() !== '/skip') {
                data.contact_info = msg.text.trim();
            }
            userState.data = data;
            userState.step = 'notes';
            userStates.set(userId, userState);
            
            let contactText = '';
            if (data.contact_info) {
                contactText += `📱 Контакты: ${data.contact_info} ✅\n\n`;
            }
            contactText += '📝 *Дополнительные заметки (необязательно)*\n';
            contactText += 'Например: "красивый кабриолет", "стоял долго", "владелец рядом был"\n\n';
            contactText += '• Введите заметки\n';
            contactText += '• /skip - пропустить этот вопрос\n';
            contactText += '• /finish - завершить приглашение';
            
            bot.sendMessage(msg.chat.id, contactText, { parse_mode: 'Markdown' });
            break;
            
        case 'notes':
            if (msg.text.trim() === '/finish') {
                // Завершаем приглашение досрочно
                await completeCreateInvitation(msg, userId, data);
                return;
            }
            
            if (msg.text.trim() !== '/skip') {
                data.notes = msg.text.trim();
            }
            
            // Завершаем создание приглашения
            await completeCreateInvitation(msg, userId, data);
            break;
    }
}

// Функция валидации регистрационного номера
function validateRegNumber(regNumber) {
    if (!regNumber || typeof regNumber !== 'string') {
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
                year: null, // Год не указан
                reg_number: data.reg_number,
                status: 'приглашение',
                photos: data.photos && data.photos.length > 0 ? JSON.stringify(data.photos) : null
            };
            
            car = await db.createCar(carData);
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
        
        // Удаляем состояние пользователя
        userStates.delete(userId);
        
        // Отправляем подтверждение
        let confirmText = '🎉 *Приглашение зафиксировано!*\n\n';
        confirmText += `🔢 **Номер:** ${data.reg_number}\n`;
        confirmText += `📅 **Дата:** ${invitationData.invitation_date}\n`;
        
        if (data.location) {
            confirmText += `📍 **Место:** ${data.location}\n`;
        }
        if (data.photos && data.photos.length > 0) {
            confirmText += `📸 **Фотографий:** ${data.photos.length}\n`;
        }
        if (data.brand && data.brand !== 'Неизвестно') {
            confirmText += `🚗 **Марка:** ${data.brand}\n`;
        }
        if (data.model && data.model !== 'Неизвестно') {
            confirmText += `🚗 **Модель:** ${data.model}\n`;
        }
        if (data.contact_info) {
            confirmText += `📱 **Контакты:** ${data.contact_info}\n`;
        }
        if (data.notes) {
            confirmText += `📝 **Заметки:** ${data.notes}\n`;
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
        
        let invitationMessage = `🎯 *Новое приглашение!*\n\n`;
        invitationMessage += `👤 **Кто оставил:** ${inviter.first_name}`;
        if (inviter.last_name) invitationMessage += ` ${inviter.last_name}`;
        if (inviter.nickname) invitationMessage += ` (@${inviter.nickname})`;
        
        invitationMessage += `\n\n🚗 **Автомобиль:**\n`;
        invitationMessage += `🔢 **Номер:** ${data.reg_number}`;
        
        if (data.brand && data.brand !== 'Неизвестно') {
            invitationMessage += `\n🚗 **Марка:** ${data.brand}`;
        }
        if (data.model && data.model !== 'Неизвестно') {
            invitationMessage += `\n🚗 **Модель:** ${data.model}`;
        }
        
        invitationMessage += `\n📅 **Дата:** ${invitationData.invitation_date}`;
        
        if (data.location && data.location !== 'Не указано') {
            invitationMessage += `\n📍 **Место:** ${data.location}`;
        }
        
        if (data.contact_info) {
            invitationMessage += `\n📱 **Оставленные контакты:** ${data.contact_info}`;
        }
        
        if (data.notes) {
            invitationMessage += `\n📝 **Заметки:** ${data.notes}`;
        }
        
        if (data.photos && data.photos.length > 0) {
            invitationMessage += `\n📸 **Фотографий:** ${data.photos.length}`;
        }
        
        invitationMessage += `\n\n🤞 Надеемся на отклик владельца!`;
        
        // Отправляем фото автомобиля если есть
        if (data.photos && data.photos.length > 0) {
            const fs = require('fs');
            const path = require('path');
            const carPhotoPath = path.join(__dirname, '../../uploads/cars', data.photos[0]);
            
            if (fs.existsSync(carPhotoPath)) {
                await sendGroupPhoto(carPhotoPath, invitationMessage);
            } else {
                console.log('⚠️ Файл фото автомобиля не найден:', carPhotoPath);
                await sendGroupNotification(invitationMessage);
            }
        } else {
            await sendGroupNotification(invitationMessage);
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
        // Получаем информацию о файле
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
        
        // Создаём директории если их нет
        createUploadDirs();
        
        // Определяем путь для сохранения
        const filePath = path.join(config.UPLOADS.membersPath, fileName);
        
        // Загружаем файл
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // Сохраняем файл
        fs.writeFileSync(filePath, buffer);
        
        // Возвращаем относительный путь
        return `uploads/members/${fileName}`;
        
    } catch (error) {
        console.error('Ошибка загрузки фото:', error);
        throw error;
    }
}

// Функция загрузки фото автомобиля
async function downloadCarPhoto(fileId, fileName) {
    try {
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
        
        createUploadDirs();
        const filePath = path.join(config.UPLOADS.carsPath, fileName);
        
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);
        
        return `uploads/cars/${fileName}`;
        
    } catch (error) {
        console.error('Ошибка загрузки фото автомобиля:', error);
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
        
        bot.sendMessage(msg.chat.id, 
            `✅ Фото ${data.photos.length} загружено!\n\n` +
            'Можете отправить ещё фотографии или нажать /done для завершения.'
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
        
        let photoText = `✅ Фото ${data.photos.length} загружено!\n\n`;
        photoText += `🔢 Номер: ${data.reg_number}\n`;
        photoText += 'Можете отправить ещё фотографии или:\n';
        photoText += '• /done - завершить загрузку фото\n';
        photoText += '• /skip - пропустить все фото';
        
        bot.sendMessage(msg.chat.id, photoText);
        
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
            bot.sendMessage(msg.chat.id, '❌ Сначала зарегистрируйтесь командой /register');
            return;
        }
        
        userStates.set(userId, { 
            state: 'searching', 
            step: 'number'
        });
        
        bot.sendMessage(msg.chat.id, 
            '🔍 *Поиск автомобилей по номеру*\n\n' +
            'Введите регистрационный номер или его часть:\n' +
            '• Полный номер: A123BC77\n' +
            '• Частичный поиск: A123, BC77, 123\n\n' +
            'Поиск не чувствителен к регистру.',
            { parse_mode: 'Markdown' }
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
                                { text: '📋 Главное меню', callback_data: 'menu' }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        let resultsText = `🔍 *Результаты поиска по "${searchQuery}"*\n\n`;
        resultsText += `Найдено автомобилей: **${cars.length}**\n\n`;
        
        for (let i = 0; i < cars.length; i++) {
            const car = cars[i];
            resultsText += `**${i + 1}.** ${car.brand} ${car.model}`;
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
                        resultsText += `\n📅 Последнее: ${lastInvitation.invitation_date}`;
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
                        { text: '📋 Главное меню', callback_data: 'menu' }
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