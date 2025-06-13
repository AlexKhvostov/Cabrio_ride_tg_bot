/**
 * Обработчики команд Telegram бота
 */

const { getMessage } = require('../utils/localization');
const { checkRateLimit, sendRateLimitMessage } = require('../middleware/rateLimiter');
const memberService = require('../services/memberService');

/**
 * Обработчик команды /start
 */
async function handleStart(bot, msg) {
    const userId = msg.from.id;
    const firstName = msg.from.first_name;
    
    // Проверка rate limit
    if (!checkRateLimit(msg, 'start')) {
        return sendRateLimitMessage(bot, msg.chat.id);
    }
    
    try {
        // Проверяем, есть ли пользователь в базе
        const existingMember = await memberService.getMemberByTelegramId(userId);
        
        if (existingMember) {
            const message = getMessage('start.existingUser', {
                name: existingMember.first_name,
                status: existingMember.status,
                joinDate: existingMember.join_date
            });
            bot.sendMessage(msg.chat.id, message);
        } else {
            const message = getMessage('start.newUser', {
                welcome: getMessage('start.welcome'),
                name: firstName
            });
            bot.sendMessage(msg.chat.id, message);
        }
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        bot.sendMessage(msg.chat.id, getMessage('common.error'));
    }
}

/**
 * Обработчик команды /menu
 */
async function handleMenu(bot, msg) {
    // Проверка rate limit
    if (!checkRateLimit(msg, 'menu')) {
        return sendRateLimitMessage(bot, msg.chat.id);
    }
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                // Личный кабинет
                [
                    { text: getMessage('menu.myProfile'), callback_data: 'my_profile' },
                    { text: getMessage('menu.myCars'), callback_data: 'my_cars' }
                ],
                [
                    { text: getMessage('menu.addCar'), callback_data: 'add_car' }
                ],
                // Активности клуба
                [
                    { text: getMessage('menu.createInvitation'), callback_data: 'create_invitation' },
                    { text: getMessage('menu.searchCar'), callback_data: 'search_by_number' }
                ],
                [
                    { text: getMessage('menu.myInvitations'), callback_data: 'my_invitations' }
                ],
                // Информация
                [
                    { text: getMessage('menu.stats'), callback_data: 'stats' },
                    { text: getMessage('menu.help'), callback_data: 'help' }
                ]
            ]
        }
    };
    
    bot.sendMessage(msg.chat.id, getMessage('menu.welcome'), keyboard);
}

/**
 * Обработчик команды /register
 */
async function handleRegister(bot, msg, userStates) {
    const userId = msg.from.id;
    
    // Проверка rate limit
    if (!checkRateLimit(msg, 'register')) {
        return sendRateLimitMessage(bot, msg.chat.id);
    }
    
    try {
        // Проверяем, не зарегистрирован ли уже пользователь
        const isRegistered = await memberService.isRegistered(userId);
        
        if (isRegistered) {
            bot.sendMessage(msg.chat.id, getMessage('registration.alreadyRegistered'));
            return;
        }
        
        // Начинаем процесс регистрации
        userStates.set(userId, {
            state: 'registering',
            step: 'first_name',
            data: {
                telegram_id: userId
            }
        });
        
        bot.sendMessage(msg.chat.id, getMessage('registration.start'));
    } catch (error) {
        console.error('Ошибка в команде /register:', error);
        bot.sendMessage(msg.chat.id, getMessage('common.error'));
    }
}

/**
 * Обработчик команды /profile
 */
async function handleProfile(bot, msg) {
    const userId = msg.from.id;
    
    // Проверка rate limit
    if (!checkRateLimit(msg, 'profile')) {
        return sendRateLimitMessage(bot, msg.chat.id);
    }
    
    try {
        const member = await memberService.getMemberByTelegramId(userId);
        
        if (!member) {
            bot.sendMessage(msg.chat.id, 'Вы не зарегистрированы. Используйте /register для регистрации.');
            return;
        }
        
        const profileInfo = memberService.formatMemberProfile(member);
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: getMessage('profile.editProfile'), callback_data: 'edit_profile' },
                        { text: getMessage('common.backToMenu'), callback_data: 'menu' }
                    ]
                ]
            }
        };
        
        // Отправляем фото профиля если есть
        if (member.photo_url) {
            try {
                await bot.sendPhoto(msg.chat.id, member.photo_url, {
                    caption: `${getMessage('profile.title')}\n\n${profileInfo}`,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            } catch (photoError) {
                // Если не удалось отправить фото, отправляем только текст
                bot.sendMessage(msg.chat.id, 
                    `${getMessage('profile.title')}\n\n${profileInfo}`, 
                    { parse_mode: 'Markdown', ...keyboard }
                );
            }
        } else {
            bot.sendMessage(msg.chat.id, 
                `${getMessage('profile.title')}\n\n${profileInfo}`, 
                { parse_mode: 'Markdown', ...keyboard }
            );
        }
    } catch (error) {
        console.error('Ошибка в команде /profile:', error);
        bot.sendMessage(msg.chat.id, getMessage('common.error'));
    }
}

/**
 * Обработчик команды /help
 */
async function handleHelp(bot, msg) {
    // Проверка rate limit
    if (!checkRateLimit(msg, 'help')) {
        return sendRateLimitMessage(bot, msg.chat.id);
    }
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: getMessage('common.backToMenu'), callback_data: 'menu' }
                ]
            ]
        }
    };
    
    bot.sendMessage(msg.chat.id, 
        `${getMessage('help.title')}\n\n${getMessage('help.commands')}`, 
        { parse_mode: 'Markdown', ...keyboard }
    );
}

/**
 * Обработчик команды /stats
 */
async function handleStats(bot, msg) {
    // Проверка rate limit
    if (!checkRateLimit(msg, 'stats')) {
        return sendRateLimitMessage(bot, msg.chat.id);
    }
    
    try {
        const stats = await memberService.getMemberStats();
        // Здесь нужно будет добавить получение статистики автомобилей и приглашений
        
        const message = getMessage('stats.info', {
            activeMembers: stats.activeMembers,
            activeCars: 0, // TODO: получить из сервиса автомобилей
            totalInvitations: 0, // TODO: получить из сервиса приглашений
            leftMembers: stats.leftMembers,
            leftCars: 0 // TODO: получить из сервиса автомобилей
        });
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: getMessage('common.backToMenu'), callback_data: 'menu' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(msg.chat.id, 
            `${getMessage('stats.title')}\n\n${message}`, 
            { parse_mode: 'Markdown', ...keyboard }
        );
    } catch (error) {
        console.error('Ошибка в команде /stats:', error);
        bot.sendMessage(msg.chat.id, getMessage('common.error'));
    }
}

/**
 * Обработчик команды /skip
 */
function handleSkip(bot, msg, userStates) {
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, 'Нет активного процесса для пропуска.');
        return;
    }
    
    // Логика пропуска будет реализована в соответствующих обработчиках процессов
    bot.sendMessage(msg.chat.id, 'Шаг пропущен.');
}

/**
 * Обработчик команды /done
 */
function handleDone(bot, msg, userStates) {
    const userId = msg.from.id;
    const userState = userStates.get(userId);
    
    if (!userState) {
        bot.sendMessage(msg.chat.id, 'Нет активного процесса для завершения.');
        return;
    }
    
    // Логика завершения будет реализована в соответствующих обработчиках процессов
    bot.sendMessage(msg.chat.id, 'Процесс завершен.');
}

module.exports = {
    handleStart,
    handleMenu,
    handleRegister,
    handleProfile,
    handleHelp,
    handleStats,
    handleSkip,
    handleDone
}; 