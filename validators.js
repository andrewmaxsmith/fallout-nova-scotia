function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function validateNumber(value, {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
    label = 'value'
} = {}) {
    if (!isFiniteNumber(value)) {
        return { ok: false, error: `${label} must be a number.` };
    }

    if (integer && !Number.isInteger(value)) {
        return { ok: false, error: `${label} must be an integer.` };
    }

    if (value < min || value > max) {
        return { ok: false, error: `${label} must be between ${min} and ${max}.` };
    }

    return { ok: true, value };
}

function validateNumericRecord(record, {
    allowedKeys,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
    label = 'record'
} = {}) {
    if (!isPlainObject(record)) {
        return { ok: false, error: `${label} must be an object.` };
    }

    const keys = Object.keys(record);
    if (keys.length === 0) {
        return { ok: false, error: `${label} cannot be empty.` };
    }

    for (const key of keys) {
        if (Array.isArray(allowedKeys) && !allowedKeys.includes(key)) {
            return { ok: false, error: `Unsupported key: ${key}.` };
        }

        const result = validateNumber(record[key], {
            min,
            max,
            integer,
            label: `${label}.${key}`
        });

        if (!result.ok) {
            return result;
        }
    }

    return { ok: true };
}

module.exports = {
    isPlainObject,
    isFiniteNumber,
    validateNumber,
    validateNumericRecord
};
