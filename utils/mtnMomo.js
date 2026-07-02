/**
 * MTN MoMo Collection API integration
 * Docs: https://momodeveloper.mtn.com/docs/services/collection
 *
 * Required env vars:
 *   MTN_MOMO_SUBSCRIPTION_KEY   — Primary key from MTN developer portal
 *   MTN_MOMO_API_USER           — UUID created via API user provisioning
 *   MTN_MOMO_API_KEY            — Key for the API user
 *   MTN_MOMO_ENVIRONMENT        — "sandbox" or "production"
 *   MTN_MOMO_CURRENCY           — "EUR" for sandbox, "RWF" for production
 *   MTN_MOMO_CALLBACK_URL       — Your backend URL for payment callbacks (optional)
 */

const crypto = require('crypto');

const BASE_URL = {
    sandbox: 'https://sandbox.momodeveloper.mtn.com',
    production: 'https://collection.momodeveloper.mtn.com',
};

function getConfig() {
    const env = (process.env.MTN_MOMO_ENVIRONMENT || 'sandbox').toLowerCase();
    return {
        env,
        baseUrl: BASE_URL[env] || BASE_URL.sandbox,
        subscriptionKey: process.env.MTN_MOMO_SUBSCRIPTION_KEY || '',
        apiUser: process.env.MTN_MOMO_API_USER || '',
        apiKey: process.env.MTN_MOMO_API_KEY || '',
        currency: process.env.MTN_MOMO_CURRENCY || (env === 'production' ? 'RWF' : 'EUR'),
        callbackUrl: process.env.MTN_MOMO_CALLBACK_URL || '',
    };
}

function isConfigured() {
    const cfg = getConfig();
    return Boolean(cfg.subscriptionKey && cfg.apiUser && cfg.apiKey);
}

/**
 * Get an access token from MTN MoMo
 */
async function getAccessToken() {
    const cfg = getConfig();
    const credentials = Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString('base64');

    const res = await fetch(`${cfg.baseUrl}/collection/token/`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
            'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`MTN token error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.access_token;
}

/**
 * Request a payment from a subscriber (request-to-pay)
 * @param {Object} params
 * @param {string} params.phone       - Phone number in format 2507XXXXXXXX (no +)
 * @param {number} params.amount      - Amount in RWF (or EUR for sandbox)
 * @param {string} params.reference   - Your internal payment reference
 * @param {string} params.description - Payment description shown to user
 * @returns {string} externalId — the UUID to use when checking status
 */
async function requestToPay({ phone, amount, reference, description }) {
    const cfg = getConfig();

    if (!isConfigured()) {
        throw new Error('MTN MoMo API is not configured. Set MTN_MOMO_SUBSCRIPTION_KEY, MTN_MOMO_API_USER, and MTN_MOMO_API_KEY.');
    }

    const token = await getAccessToken();
    const externalId = crypto.randomUUID();

    // Normalize phone: strip leading + or 0, ensure starts with 250
    const normalized = phone.replace(/^\+/, '').replace(/^0/, '');
    const msisdn = normalized.startsWith('250') ? normalized : `250${normalized}`;

    const body = {
        amount: String(Math.round(amount)),
        currency: cfg.currency,
        externalId,
        payer: {
            partyIdType: 'MSISDN',
            partyId: msisdn,
        },
        payerMessage: description || `Lumina Cinema - ${reference}`,
        payeeNote: reference,
    };

    const headers = {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': externalId,
        'X-Target-Environment': cfg.env,
        'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        'Content-Type': 'application/json',
    };

    if (cfg.callbackUrl) {
        headers['X-Callback-Url'] = cfg.callbackUrl;
    }

    const res = await fetch(`${cfg.baseUrl}/collection/v1_0/requesttopay`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    if (res.status !== 202) {
        const errBody = await res.text();
        throw new Error(`MTN request-to-pay error ${res.status}: ${errBody}`);
    }

    return externalId;
}

/**
 * Check the status of a payment
 * @param {string} externalId - The UUID returned from requestToPay
 * @returns {{ status: 'PENDING'|'SUCCESSFUL'|'FAILED', reason?: string }}
 */
async function checkPaymentStatus(externalId) {
    const cfg = getConfig();

    if (!isConfigured()) {
        throw new Error('MTN MoMo API is not configured.');
    }

    const token = await getAccessToken();

    const res = await fetch(`${cfg.baseUrl}/collection/v1_0/requesttopay/${externalId}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Target-Environment': cfg.env,
            'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        },
    });

    if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`MTN status check error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    return {
        status: data.status,           // PENDING | SUCCESSFUL | FAILED
        reason: data.reason || null,   // failure reason if FAILED
        data,
    };
}

/**
 * Get account balance
 */
async function getBalance() {
    const cfg = getConfig();
    const token = await getAccessToken();

    const res = await fetch(`${cfg.baseUrl}/collection/v1_0/account/balance`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Target-Environment': cfg.env,
            'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        },
    });

    if (!res.ok) throw new Error(`MTN balance error ${res.status}`);
    return res.json();
}

module.exports = { requestToPay, checkPaymentStatus, getBalance, isConfigured, getConfig };
