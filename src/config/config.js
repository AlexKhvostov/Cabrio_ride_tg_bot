// Диагностика загрузки переменных окружения
console.log('🔍 Диагностика переменных окружения:');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'Загружен ✅' : 'Не найден ❌');
console.log('CHAT_ID:', process.env.CHAT_ID ? `Загружен ✅ (${process.env.CHAT_ID})` : 'Не найден ❌');
console.log('DB_HOST:', process.env.DB_HOST ? 'Загружен ✅' : 'Не найден ❌');

// Конфигурация Telegram бота
module.exports = {
    // Токен бота из .env
    BOT_TOKEN: process.env.BOT_TOKEN,
    
    // ID чата для проверки участников (конвертируем в число)
    CHAT_ID: process.env.CHAT_ID ? parseInt(process.env.CHAT_ID) : undefined,
    
    // Настройки базы данных MySQL
    DATABASE: {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306
    },
    
    // Настройки файлов
    UPLOADS: {
        membersPath: './uploads/members/',
        carsPath: './uploads/cars/',
        maxFileSize: 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    },
    
    // Администраторы бота (можно добавить в .env если нужно)
    ADMINS: process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [],
    
    // Настройки клуба
    CLUB: {
        name: 'Cabrio Club',
        description: 'Клуб любителей кабриолетов',
        welcomeMessage: '🚗 Добро пожаловать в Cabrio Club!',
        groupLink: 'https://t.me/Cabrio_Ride',
        botLink: 'https://t.me/Cabrio_Ride_bot'
    }
}; 