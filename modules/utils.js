const // Versions
    V1 = 'v1',
    V2 = 'v2',

    SUPPORTED_VERSIONS = new Set([
        V1, 
        V2
    ]),

    SUPPORTED_LANGUAGES = new Set([
        'hi', 	 // Hindi
        'en',    // English (US)
        'en-uk', // English (UK)
        'es', 	 // Spanish
        'fr',	 // French
        'ja',    // Japanese
        'cs',    // Czech
        'nl',    // Dutch
        'sk',    // Slovak
        'ru',	 // Russian
        'de', 	 // German
        'it', 	 // Italian
        'ko',	 // Korean
        'pt-BR', // Brazilian Portuguese
        'ar',    // Arabic
        'tr'     // Turkish
    ]);

module.exports = {
    logEvent (word, language, message, additionalInfo = {}) {
        // Structured logging for better production monitoring
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            word: word,
            language: language,
            message: message,
            additionalInfo: additionalInfo,
            pid: process.pid
        };
        
        // Use JSON logging for easier parsing by log aggregators
        console.log(JSON.stringify(logEntry));
    },

    isLanguageSupported (language) {
        return SUPPORTED_LANGUAGES.has(language);
    },

    isVersionSupported (version) {
        return SUPPORTED_VERSIONS.has(version);
    }
}