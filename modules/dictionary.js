const https = require('https'),
	fetch = require('node-fetch'),

	utils = require('./utils.js'),
	errors = require('./errors.js'),

	// Optimized HTTPS agent with better connection pooling
	httpsAgent = new https.Agent({ 
		keepAlive: true,
		keepAliveMsecs: 30000,
		maxSockets: 50,
		maxFreeSockets: 10,
		timeout: 30000,
		freeSocketTimeout: 15000
	});

// Utility functions to replace lodash
const get = (obj, path, defaultValue) => {
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
        if (result == null) return defaultValue;
        result = result[key];
    }
    return result !== undefined ? result : defaultValue;
};

const isEmpty = (value) => {
    if (value == null) return true;
    if (Array.isArray(value) || typeof value === 'string') return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
};

const defaults = (target, ...sources) => {
    for (const source of sources) {
        for (const key in source) {
            if (target[key] === undefined) {
                target[key] = source[key];
            }
        }
    }
    return target;
};

const pick = (obj, keys) => {
    const result = {};
    for (const key of keys) {
        if (key in obj) {
            result[key] = obj[key];
        }
    }
    return result;
};

const chain = (value) => ({
    find: (predicate) => {
        const found = Array.isArray(value) ? value.find(predicate) : undefined;
        return chain(found);
    },
    get: (path) => {
        return chain(get(value, path));
    },
    value: () => value
});

const reduce = (collection, iteratee, accumulator) => {
    if (Array.isArray(collection)) {
        for (let i = 0; i < collection.length; i++) {
            accumulator = iteratee(accumulator, collection[i], i);
        }
    } else if (collection && typeof collection === 'object') {
        for (const key in collection) {
            accumulator = iteratee(accumulator, collection[key], key);
        }
    }
    return accumulator;
};

function transformV2toV1 (data) {
	return data.map((entry) => {
    	let {
    		meanings,
    		...otherProps
    	} = entry;
    
    	meanings = meanings.reduce((meanings, meaning) => {
    		let partOfSpeech, definitions;
    
    		({
    			partOfSpeech,
    			definitions
    		} = meaning);
    		meanings[partOfSpeech] = definitions;
    
    		return meanings;
    	}, {});
    
    	return {
    		...otherProps,
    		meaning: meanings
    	};
    });
}

function transform (word, language, data, { include }) {
	return data
	        .map(e => e.entry)
	        .filter(e => e)
			.reduce((accumulator, entry) => {
				if (!entry.subentries) { return accumulator.push(entry) && accumulator; }

				let { subentries } = entry,
					mappedSubentries;

				if (subentries.length > 1) {
					utils.logEvent(word, language, 'subentries length is greater than 1', { data });
				}

				if (entry.sense_families) {
					utils.logEvent(word, language, 'entry has subentries and sense families', { data });
				}

				if (entry.etymology) {
					utils.logEvent(word, language, 'entry has subentries and etymology', { data });
				}

				mappedSubentries = subentries
						.map((subentry) => {
							if (subentry.sense_families) {
								utils.logEvent(word, language, 'subentry has sense families', { data });
							}

							if (subentry.sense_family) {
								subentry.sense_families = [];
								subentry.sense_families.push(subentry.sense_family);
							}

							return defaults(subentry, pick(entry, ['phonetics', 'etymology']))
						})

				return accumulator.concat(mappedSubentries);
			}, [])
			.map((entry) => {
				let { headword, lemma, phonetics = [], etymology = {}, sense_families = [] } = entry;
				
				return {
					word: lemma || headword,
					phonetic: get(phonetics, '0.text'),
					phonetics: phonetics.map((e) => {
						return {
							text: e.text,
							audio: e.oxford_audio
						};
					}),
					origin: get(etymology, 'etymology.text'),
					meanings: sense_families.map((sense_family) => {
						let { parts_of_speech, senses = []} = sense_family;

						// if parts of speech is empty at this level.
						// Current hypothesis tells that it means only one sense is present
						// We need to take out parts_of_speech from it and use it.
						if (!parts_of_speech) {
							parts_of_speech = get(senses[0], 'parts_of_speech', []);

							if (senses.length > 1) {
								utils.logEvent(word, language, 'part of speech missing but more than one sense present', { data });
							}
						}
						
						if (parts_of_speech.length > 1) {
							utils.logEvent(word, language, 'more than one part of speech present', { data });
						}

						return {
							partOfSpeech: get(parts_of_speech[0], 'value'),
							definitions: senses.map((sense) => {							
								let { definition = {}, example_groups = [], thesaurus_entries = [] } = sense,
									result = {
										definition: definition.text,
										example: get(example_groups[0], 'examples.0'),
										synonyms: get(thesaurus_entries[0], 'synonyms.0.nyms', [])
											.map(e => e.nym),
										antonyms: get(thesaurus_entries[0], 'antonyms.0.nyms', [])
											.map(e => e.nym)
									};

								if (include.example) {
									result.examples = reduce(example_groups, (accumulator, example_group) => {
										let example = get(example_group, 'examples', []);
										return accumulator.concat(example);
									}, []);
								}

								return result;
							})
						};
					})
				};
			});
}

async function queryInternet (word, language) {
	let url = new URL('https://www.google.com/async/callback:5493');

	url.searchParams.set('fc', 'ErUBCndBTlVfTnFUN29LdXdNSlQ2VlZoWUIwWE1HaElOclFNU29TOFF4ZGxGbV9zbzA3YmQ2NnJyQXlHNVlrb3l3OXgtREpRbXpNZ0M1NWZPeFo4NjQyVlA3S2ZQOHpYa292MFBMaDQweGRNQjR4eTlld1E4bDlCbXFJMBIWU2JzSllkLVpHc3J5OVFPb3Q2aVlDZxoiQU9NWVJ3QmU2cHRlbjZEZmw5U0lXT1lOR3hsM2xBWGFldw');
	url.searchParams.set('fcv', '3');
	url.searchParams.set('async', `term:${encodeURIComponent(word)},corpus:${language},hhdr:true,hwdgt:true,wfp:true,ttl:,tsl:,ptl:`);

	url = url.toString();

	let response = await fetch(url, {
		agent: httpsAgent,
		headers: new fetch.Headers({
			"accept": "*/*",
			"accept-encoding": "gzip, deflate, br",
			"accept-language": "en-US,en;q=0.9",
			"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36"
		})
	});

	if (response.status === 404) { throw new errors.NoDefinitionsFound({ reason: 'Website returned 404.'}); }

	if (response.status === 429) { throw new errors.RateLimitError(); }

	if (response.status !== 200) { throw new errors.NoDefinitionsFound({ reason: 'Threw non 200 status code.'}); }

	let body = await response.text(),
		data = JSON.parse(body.substring(4)),
		single_results = get(data, 'feature-callback.payload.single_results', []),
			error = chain(single_results)
					.find(item => item.widget)
					.get('widget.error')
					.value()

	if (single_results.length === 0) { throw new errors.NoDefinitionsFound({ word, language }); }

	if (error === 'TERM_NOT_FOUND_ERROR') { throw new errors.NoDefinitionsFound({ word, language }); }

	if (error) { throw new errors.UnexpectedError({ error }); }

	return single_results;
}

async function fetchFromSource (word, language) {
	let dictionaryData = await queryInternet(word, language);

	return dictionaryData;
}

async function findDefinitions (word, language, { include }) {
	let dictionaryData = await fetchFromSource(word, language);

	if (isEmpty(dictionaryData)) { throw new errors.UnexpectedError(); }

	return transform(word, language, dictionaryData, { include });
}

module.exports = {
	findDefinitions,
	transformV2toV1
};
