const express = require('express'),
    compression = require('compression'),
    rateLimit = require("express-rate-limit"),
    { parse } = require('node-html-parser'),
    NodeCache = require('node-cache'),

    utils = require('./modules/utils.js'),
    errors = require('./modules/errors.js'),
    dictionary = require('./modules/dictionary.js'),

    // Cache configuration: 1 hour TTL, check every 10 minutes
    cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 }),

    app = express(),
    limiter = rateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 450, // limit each IP to 450 requests per windowMs
        standardHeaders: true,
        legacyHeaders: false
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

function cleanText (text) {
    if (!text) { return text; }

    // Using lighter HTML parser - 10x smaller than jsdom
    const root = parse(text);
    return root.text || text;
}


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

// Enable gzip compression for all responses
app.use(compression({
    level: 6, // Good balance between compression ratio and speed
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
        // Compress JSON responses
        if (res.getHeader('Content-Type')?.includes('application/json')) {
            return true;
        }
        return compression.filter(req, res);
    }
}));

app.use(limiter);

app.get('/api/:version/entries/:language/:word', async (req, res) => {
    let { word, language, version } = req.params;

    // Optimize include parameter parsing - replace lodash with native JavaScript
    const includeStr = req.query.include || '';
    const include = includeStr.split(',').reduce((acc, current) => {
        if (current.trim()) acc[current.trim()] = true;
        return acc;
    }, {});

    word = decodeURIComponent(word);

    if (!word || !language || !version) {
        return handleError.call(res, new errors.NoDefinitionsFound()); 
    }

    if (!utils.isVersionSupported(version)) { 
        return handleError.call(res, new errors.NoDefinitionsFound()); 
    }

    // Normalize language codes
    if (language === 'en_US' || language === 'en_GB') { 
        language = 'en'; 
    }
    language = language.toLowerCase();

    if (!utils.isLanguageSupported(language)) { 
        return handleError.call(res, new errors.NoDefinitionsFound()); 
    }

    word = word.trim().toLocaleLowerCase(language);

    // Create cache key
    const cacheKey = `${version}:${language}:${word}:${includeStr}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        res.set(HEADER_CONTENT_TYPE, 'application/json');
        res.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');
        res.set('X-Cache', 'HIT');
        return res.status(200).send(cachedResult);
    }

    try {
        let definitions = await dictionary.findDefinitions(word, language, { include });

        if (version === V1) {
            definitions = dictionary.transformV2toV1(definitions);
        }

        const body = JSON.stringify(definitions, (key, value) => {
            if (typeof value === 'object') { return value; }
            return cleanText(value);
        });

        // Cache the result
        cache.set(cacheKey, body);

        res.set(HEADER_CONTENT_TYPE, 'application/json');
        res.set(HEADER_ACCESS_CONTROL_ALLOW_ORIGIN, '*');
        res.set('X-Cache', 'MISS');

        return res.status(200).send(body);
    } catch (error) {
        return handleError.call(res, error);
    }
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    const stats = cache.getStats();
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cache: {
            hits: stats.hits,
            misses: stats.misses,
            keys: stats.keys,
            hitRate: stats.hits / (stats.hits + stats.misses) || 0
        },
        memory: process.memoryUsage()
    });
});

// Performance monitoring endpoint
app.get('/api/stats', (req, res) => {
    const stats = cache.getStats();
    res.json({
        cache: {
            hits: stats.hits,
            misses: stats.misses,
            keys: stats.keys,
            hitRate: ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%'
        },
        uptime: process.uptime(),
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
        }
    });
});

app.listen(3000, () => console.log('Server running on port 3000'));
