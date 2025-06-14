const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('../database/database');

function createAPI() {
    const app = express();
    
    // Middleware
    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../../public')));
    
    // Статические файлы для фотографий
    app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));
    
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
        const photoPath = path.join(__dirname, '../../uploads', type, filename);
        
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
    
    return app;
}

module.exports = { createAPI }; 