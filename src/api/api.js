const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('../database/database');
const config = require('../config/config');

// Время запуска сервера
const serverStartTime = new Date();

function createAPI() {
    const app = express();
    
    // CORS для поддомена c.cabrioride.by и основного домена
    app.use(cors({
        origin: [
            'https://c.cabrioride.by', 
            'https://cabrioride.by',
            'http://localhost:3000',
            'http://localhost:3001'
        ],
        credentials: true
    }));
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../../public')));
    
    // Статические файлы для фотографий
    app.use('/api/uploads', express.static(path.dirname(config.UPLOADS.membersPath)));
    
    // API Routes
    
    // Получить всех участников
    app.get('/api/members', async (req, res) => {
        try {
            console.log('🔍 API /api/members: начинаем запрос');
            const members = await db.getAllMembers();
            console.log('✅ API /api/members: получено участников:', members.length);
            res.json(members);
        } catch (error) {
            console.error('Ошибка получения участников:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить все автомобили
    app.get('/api/cars', async (req, res) => {
        try {
            const cars = await db.getAllCars();
            res.json(cars);
        } catch (error) {
            console.error('Ошибка получения автомобилей:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить все приглашения
    app.get('/api/invitations', async (req, res) => {
        try {
            const invitations = await db.getAllInvitations();
            res.json(invitations);
        } catch (error) {
            console.error('Ошибка получения приглашений:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить статистику
    app.get('/api/stats', async (req, res) => {
        try {
            const stats = await db.getStats();
            res.json(stats);
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Проверить существование фото
    app.get('/api/photo-exists/:type/:filename', (req, res) => {
        const { type, filename } = req.params;
        let photoPath;
        
        if (type === 'members') {
            photoPath = path.resolve(config.UPLOADS.membersPath, filename);
        } else if (type === 'cars') {
            photoPath = path.resolve(config.UPLOADS.carsPath, filename);
        } else {
            return res.status(400).json({ error: 'Invalid type' });
        }
        
        fs.access(photoPath, fs.constants.F_OK, (err) => {
            res.json({ exists: !err });
        });
    });

    // Проверить состояние базы данных
    app.get('/api/db-status', (req, res) => {
        res.json({
            isConnected: db.isConnected,
            connectionExists: !!db.connection,
            timestamp: new Date().toISOString()
        });
    });

    // Логи авторизации (только для админов)
    app.get('/api/auth-logs', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;
            
            const logs = await db.getAuthLogs(limit, offset);
            res.json(logs);
        } catch (error) {
            console.error('Ошибка получения логов авторизации:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });

    // Статистика авторизации
    app.get('/api/auth-stats', async (req, res) => {
        try {
            const stats = await db.getAuthStats();
            res.json(stats);
        } catch (error) {
            console.error('Ошибка получения статистики авторизации:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });

    // Логи авторизации по Telegram ID
    app.get('/api/auth-logs/:telegramId', async (req, res) => {
        try {
            const telegramId = req.params.telegramId;
            const limit = parseInt(req.query.limit) || 50;
            
            const logs = await db.getAuthLogsByTelegramId(telegramId, limit);
            res.json(logs);
        } catch (error) {
            console.error('Ошибка получения логов авторизации по ID:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });

    // Проверить статус пользователя по Telegram ID
    app.get('/api/user-status/:telegramId', async (req, res) => {
        try {
            const telegramId = parseInt(req.params.telegramId);
            
            if (!telegramId) {
                return res.status(400).json({ 
                    error: 'Invalid Telegram ID',
                    hasAccess: false 
                });
            }
            
            // Получаем пользователя из базы данных
            const member = await db.getMemberByTelegramId(telegramId);
            
            if (!member) {
                return res.json({
                    hasAccess: false,
                    reason: 'not_registered',
                    message: 'Пользователь не зарегистрирован в клубе'
                });
            }
            
            // Проверяем статус - доступ только для активных участников
            const hasAccess = member.status === 'активный';
            
            res.json({
                hasAccess: hasAccess,
                status: member.status,
                firstName: member.first_name,
                lastName: member.last_name,
                reason: hasAccess ? 'active' : 'not_active',
                message: hasAccess ? 
                    'Доступ разрешён' : 
                    `Доступ ограничен. Ваш статус: ${member.status}. Веб-дашборд доступен только активным участникам клуба.`
            });
            
        } catch (error) {
            console.error('Ошибка проверки статуса пользователя:', error);
            res.status(500).json({ 
                error: 'Ошибка базы данных',
                hasAccess: false 
            });
        }
    });
    
    // =====================================================
    // 🎉 API для событий (events)
    // =====================================================
    
    // Получить все события
    app.get('/api/events', async (req, res) => {
        try {
            const events = await db.getAllEvents();
            res.json(events);
        } catch (error) {
            console.error('Ошибка получения событий:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить событие по ID
    app.get('/api/events/:id', async (req, res) => {
        try {
            const eventId = parseInt(req.params.id);
            const event = await db.getEventById(eventId);
            
            if (!event) {
                return res.status(404).json({ error: 'Событие не найдено' });
            }
            
            res.json(event);
        } catch (error) {
            console.error('Ошибка получения события:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // =====================================================
    // 🔧 API для сервисов (services)
    // =====================================================
    
    // Получить все сервисы
    app.get('/api/services', async (req, res) => {
        try {
            const services = await db.getAllServices();
            res.json(services);
        } catch (error) {
            console.error('Ошибка получения сервисов:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить сервис по ID
    app.get('/api/services/:id', async (req, res) => {
        try {
            const serviceId = parseInt(req.params.id);
            const service = await db.getServiceById(serviceId);
            
            if (!service) {
                return res.status(404).json({ error: 'Сервис не найден' });
            }
            
            res.json(service);
        } catch (error) {
            console.error('Ошибка получения сервиса:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить сервисы по городу
    app.get('/api/services/city/:city', async (req, res) => {
        try {
            const city = req.params.city;
            const services = await db.getServicesByCity(city);
            res.json(services);
        } catch (error) {
            console.error('Ошибка получения сервисов по городу:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });
    
    // Получить сервисы по типу
    app.get('/api/services/type/:type', async (req, res) => {
        try {
            const type = req.params.type;
            const services = await db.getServicesByType(type);
            res.json(services);
        } catch (error) {
            console.error('Ошибка получения сервисов по типу:', error);
            res.status(500).json({ error: 'Ошибка базы данных' });
        }
    });

    // Время работы сервера
    app.get('/api/uptime', (req, res) => {
        try {
            const currentTime = new Date();
            const uptimeMs = currentTime - serverStartTime;
            
            // Вычисляем время работы в различных единицах
            const uptimeSeconds = Math.floor(uptimeMs / 1000);
            const uptimeMinutes = Math.floor(uptimeSeconds / 60);
            const uptimeHours = Math.floor(uptimeMinutes / 60);
            const uptimeDays = Math.floor(uptimeHours / 24);
            
            // Остатки для точного отображения
            const remainingHours = uptimeHours % 24;
            const remainingMinutes = uptimeMinutes % 60;
            const remainingSeconds = uptimeSeconds % 60;
            
            // Форматируем строку времени работы
            let uptimeString = '';
            if (uptimeDays > 0) {
                uptimeString += `${uptimeDays} дн. `;
            }
            if (remainingHours > 0 || uptimeDays > 0) {
                uptimeString += `${remainingHours} ч. `;
            }
            if (remainingMinutes > 0 || uptimeHours > 0) {
                uptimeString += `${remainingMinutes} мин. `;
            }
            uptimeString += `${remainingSeconds} сек.`;
            
            res.json({
                startTime: serverStartTime.toISOString(),
                currentTime: currentTime.toISOString(),
                uptimeMs: uptimeMs,
                uptimeSeconds: uptimeSeconds,
                uptimeMinutes: uptimeMinutes,
                uptimeHours: uptimeHours,
                uptimeDays: uptimeDays,
                uptimeFormatted: uptimeString.trim(),
                status: 'running'
            });
        } catch (error) {
            console.error('Ошибка получения времени работы сервера:', error);
            res.status(500).json({ error: 'Ошибка сервера' });
        }
    });
    
    return app;
}

module.exports = { createAPI }; 