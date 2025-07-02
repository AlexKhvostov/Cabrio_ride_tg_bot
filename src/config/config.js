// Загружаем переменные окружения из .env файла
require('dotenv').config();

// Настройка путей для загрузки файлов
const path = require('path');
const uploadsBasePath = process.env.UPLOADS_BASE_PATH || './uploads';

// Диагностика загрузки переменных окружения
console.log('🔍 Диагностика переменных окружения:');
console.log('BOT_TOKEN:', process.env.BOT_TOKEN ? 'Загружен ✅' : 'Не найден ❌');
console.log('CHAT_ID:', process.env.CHAT_ID ? `Загружен ✅ (${process.env.CHAT_ID})` : 'Не найден ❌');
console.log('DB_HOST:', process.env.DB_HOST ? 'Загружен ✅' : 'Не найден ❌');
console.log('ADMIN_IDS:', process.env.ADMIN_IDS ? 'Загружен ✅' : 'Не найден ❌');
console.log('UPLOADS_BASE_PATH:', process.env.UPLOADS_BASE_PATH ? `Загружен ✅ (${process.env.UPLOADS_BASE_PATH})` : 'Используется по умолчанию ⚠️ (./uploads)');

// Проверяем критически важные переменные
if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден в .env файле!');
    process.exit(1);
}

if (!process.env.CHAT_ID) {
    console.error('❌ CHAT_ID не найден в .env файле!');
    process.exit(1);
}

if (!process.env.DB_HOST) {
    console.error('❌ DB_HOST не найден в .env файле!');
    process.exit(1);
}

	console.log('DB_HOST:' , process.env.DB_HOST ) 
	console.log('DB_USER:' , process.env.DB_USER ) 
	console.log('DB_NAME:' , process.env.DB_NAME )
	
	
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
        membersPath: path.resolve(__dirname, uploadsBasePath, 'members/'),
        carsPath: path.resolve(__dirname, uploadsBasePath, 'cars/'),
        maxFileSize: 10 * 1024 * 1024, // 10MB
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