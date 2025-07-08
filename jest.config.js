module.exports = {
    testEnvironment: 'node',
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    testMatch: ['**/tests/**/*.test.js'],
    collectCoverageFrom: [
        '*.js',
        'modules/*.js',
        '!coverage/**',
        '!node_modules/**',
        '!jest.config.js'
    ],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    testTimeout: 10000
};