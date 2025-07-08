// Test setup file for Jest
global._ = require('lodash');

// Mock console methods for cleaner test output
global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

// Set test environment variables
process.env.NODE_ENV = 'test';