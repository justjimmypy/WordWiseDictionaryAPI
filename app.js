const { JSDOM } = require('jsdom'),
    express = require('express'),
    rateLimit = require("express-rate-limit"),

    utils = require('./modules/utils.js'),
    errors = require('./modules/errors.js'),
    dictionary = require('./modules/dictionary.js'),

    // HTML Parser - Reuse the same parser instance for better performance
    { DOMParser } = new JSDOM().window,
    parser = new DOMParser(),

    app = express(),

    // In-memory cache for API responses (consider Redis for production)
    cache = new Map(),
    CACHE_TTL = 60 * 60 * 1000, // 1 hour in milliseconds
    
    // Reduced rate limiting to help with server costs
    limiter = rateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 100, // reduced from 450 to 100 requests per windowMs
        message: JSON.stringify({
            title: 'Rate Limit Exceeded',
            message: 'Too many requests from this IP, please try again later.',
            resolution: 'Wait a few minutes before making another request.'
        }),
        standardHeaders: true,
        legacyHeaders: false,
    }),

    // Versions
    V1 = 'v1',
    V2 = 'v2',

    // Status Codes
    REQUEST_TYPE_STATUS_CODE = {
        notFound: 404,
        rateLimit: 429,
        serverError: 500
    },

    // Headers
    HEADER_CONTENT_TYPE = 'Content-Type',
    HEADER_ACCESS_CONTROL_ALLOW_ORIGIN = 'Access-Control-Allow-Origin';

// GLOBALS
global._ = require('lodash');

// Optimize cleanText function with caching for repeated text
const textCache = new Map();
function cleanText (text) {
    if (!text) { return text; }
    
    // Check cache first for performance
    if (textCache.has(text)) {
        return textCache.get(text);
    }

    const cleaned = parser
        .parseFromString(text, "text/html")
        .body.textContent;
    
    // Cache the result (limit cache size to prevent memory issues)
    if (textCache.size < 1000) {
        textCache.set(text, cleaned);
    }
    
    return cleaned;
}

// Cache helper functions
function getCacheKey(word, language, version, include) {
    return `${word}:${language}:${version}:${JSON.stringify(include)}`;
}

function isValidCacheEntry(entry) {
    return entry && (Date.now() - entry.timestamp) < CACHE_TTL;
}

function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp >= CACHE_TTL) {
            cache.delete(key);
        }
    }
}

// Clean expired cache entries every 30 minutes
setInterval(cleanExpiredCache, 30 * 60 * 1000);


function handleError (error = {}) {
    // Using duck typing to know if we explicitly threw this error
    // If not then wrapping original error into UnexpectedError
    if (!error.requestType) { error = new errors.UnexpectedError({ original_error: error }); }

    const { requestType, title, message, resolution } = error;
        status = REQUEST_TYPE_STATUS_CODE[requestType],
        body = JSON.stringify({
            title,
            message,
            resolution
        });

    this.set(HEADER_CONTENT_TYPE, 'application/json');
    this.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');

    return this.status(status).send(body);
};

app.set('trust proxy', true);

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    const healthcheck = {
        uptime: process.uptime(),
        message: 'OK',
        timestamp: Date.now(),
        cache_size: cache.size,
        memory_usage: process.memoryUsage()
    };
    
    res.set(HEADER_CONTENT_TYPE, 'application/json');
    res.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');
    res.status(200).send(JSON.stringify(healthcheck));
});

// Cache stats endpoint for monitoring
app.get('/cache/stats', (req, res) => {
    const stats = {
        cache_size: cache.size,
        text_cache_size: textCache.size,
        timestamp: Date.now()
    };
    
    res.set(HEADER_CONTENT_TYPE, 'application/json');
    res.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');
    res.status(200).send(JSON.stringify(stats));
});

// Add compression for better performance
app.use(express.json({ limit: '10mb' }));

app.use(limiter);

app.get('/api/:version/entries/:language/:word', async (req, res) => {
    let { word, language, version } = req.params,
        include = _.reduce(_.get(req.query, 'include', '').split(','), (accumulator, current) => {
            accumulator[current] = true;
            return accumulator;
        }, {});

    word = decodeURIComponent(word);

    // Input validation
    if (!word || !language || !version) {
        return handleError.call(res, new errors.NoDefinitionsFound()); 
    }

    // Sanitize inputs
    word = word.trim();
    language = language.trim().toLowerCase();
    version = version.trim().toLowerCase();

    // Version validation
    if (!utils.isVersionSupported(version)) { 
        return handleError.call(res, new errors.NoDefinitionsFound()); 
    }

    // Language normalization and validation
    if (language === 'en_us' || language === 'en_gb') { 
        language = 'en'; 
    }

    if (!utils.isLanguageSupported(language)) { 
        return handleError.call(res, new errors.NoDefinitionsFound()); 
    }

    word = word.toLowerCase();

    // Check cache first
    const cacheKey = getCacheKey(word, language, version, include);
    const cachedEntry = cache.get(cacheKey);
    
    if (isValidCacheEntry(cachedEntry)) {
        // Cache hit - return cached response
        res.set(HEADER_CONTENT_TYPE, 'application/json');
        res.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');
        res.set('X-Cache', 'HIT');
        return res.status(200).send(cachedEntry.data);
    }

    try {
        let definitions = await dictionary.findDefinitions(word, language, { include }),
            status = 200,
            body;

        if (version === V1) {
            definitions = dictionary.transformV2toV1(definitions);
        }

        body = JSON.stringify(definitions, (key, value) => {
            if (typeof value === 'object') { return value; }
            return cleanText(value);
        });

        // Cache the response
        cache.set(cacheKey, {
            data: body,
            timestamp: Date.now()
        });

        res.set(HEADER_CONTENT_TYPE, 'application/json');
        res.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');
        res.set('X-Cache', 'MISS');

        return res.status(status).send(body);
    } catch (error) {
        return handleError.call(res, error);
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));
