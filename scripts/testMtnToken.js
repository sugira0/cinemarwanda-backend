require('dotenv').config();
const { getConfig } = require('../utils/mtnMomo');

async function main() {
    const cfg = getConfig();
    const credentials = Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString('base64');

    console.log('Testing MTN token endpoint...');
    console.log('URL:', `${cfg.baseUrl}/collection/token/`);

    const res = await fetch(`${cfg.baseUrl}/collection/token/`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
            'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
        },
    });

    const body = await res.text();
    console.log('Status:', res.status);

    if (res.ok) {
        const data = JSON.parse(body);
        console.log('✅ Token received! Expires in:', data.expires_in, 'seconds');
        console.log('Token type:', data.token_type);
    } else {
        console.log('❌ Failed:', body);
    }
}

main().catch(console.error);
