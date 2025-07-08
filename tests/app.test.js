const request = require('supertest');
const express = require('express');

// Mock the modules to avoid external API calls during testing
jest.mock('../modules/dictionary.js', () => ({
    findDefinitions: jest.fn().mockResolvedValue([{
        word: 'test',
        phonetic: 'test',
        phonetics: [],
        origin: 'test origin',
        meanings: [{
            partOfSpeech: 'noun',
            definitions: [{
                definition: 'a test definition',
                example: 'test example',
                synonyms: [],
                antonyms: []
            }]
        }]
    }]),
    transformV2toV1: jest.fn((data) => data)
}));

// Import app after mocking
const app = require('../app.js');

describe('Dictionary API', () => {
    describe('Health Check', () => {
        test('GET /health should return health status', async () => {
            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).toHaveProperty('uptime');
            expect(response.body).toHaveProperty('message', 'OK');
            expect(response.body).toHaveProperty('timestamp');
            expect(response.body).toHaveProperty('cache_size');
        });
    });

    describe('Cache Stats', () => {
        test('GET /cache/stats should return cache statistics', async () => {
            const response = await request(app)
                .get('/cache/stats')
                .expect(200);

            expect(response.body).toHaveProperty('cache_size');
            expect(response.body).toHaveProperty('text_cache_size');
            expect(response.body).toHaveProperty('timestamp');
        });
    });

    describe('Dictionary Endpoints', () => {
        test('GET /api/v2/entries/en/test should return definition', async () => {
            const response = await request(app)
                .get('/api/v2/entries/en/test')
                .expect(200);

            expect(response.headers['content-type']).toMatch(/json/);
            expect(response.headers['access-control-allow-origin']).toBe('*');
        });

        test('GET /api/v1/entries/en/test should return v1 format', async () => {
            const response = await request(app)
                .get('/api/v1/entries/en/test')
                .expect(200);

            expect(response.headers['content-type']).toMatch(/json/);
        });

        test('Should return 404 for unsupported language', async () => {
            const response = await request(app)
                .get('/api/v2/entries/xyz/test')
                .expect(404);

            expect(response.body).toHaveProperty('title');
            expect(response.body).toHaveProperty('message');
        });

        test('Should return 404 for unsupported version', async () => {
            const response = await request(app)
                .get('/api/v3/entries/en/test')
                .expect(404);

            expect(response.body).toHaveProperty('title');
        });

        test('Should handle caching properly', async () => {
            // First request
            const response1 = await request(app)
                .get('/api/v2/entries/en/hello')
                .expect(200);

            expect(response1.headers['x-cache']).toBe('MISS');

            // Second request should hit cache
            const response2 = await request(app)
                .get('/api/v2/entries/en/hello')
                .expect(200);

            expect(response2.headers['x-cache']).toBe('HIT');
        });
    });

    describe('Rate Limiting', () => {
        test('Should enforce rate limits', async () => {
            // Make multiple requests to test rate limiting
            const promises = Array(150).fill().map(() => 
                request(app).get('/api/v2/entries/en/test')
            );

            const responses = await Promise.all(promises);
            const rateLimitedResponses = responses.filter(r => r.status === 429);
            
            expect(rateLimitedResponses.length).toBeGreaterThan(0);
        }, 10000);
    });
});