function isMetaWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function isGenericWhatsAppConfigured() {
  return Boolean(process.env.WHATSAPP_API_URL);
}

function buildVerificationMessage(code, deviceName) {
  return [
    'CINEMA Rwanda device removal verification',
    `Code: ${code}`,
    deviceName ? `Device: ${deviceName}` : null,
    'This code expires in 10 minutes.',
  ].filter(Boolean).join('\n');
}

async function sendViaMeta(phone, message) {
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(phone).replace(/\D/g, ''),
        type: 'text',
        text: { body: message },
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`WhatsApp delivery failed: ${details}`);
  }
}

async function sendViaGeneric(phone, message) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (process.env.WHATSAPP_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.WHATSAPP_API_TOKEN}`;
  }

  const response = await fetch(process.env.WHATSAPP_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: phone,
      message,
      channel: 'whatsapp',
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`WhatsApp delivery failed: ${details}`);
  }
}

async function sendDeviceRemovalWhatsapp(phone, code, deviceName) {
  const message = buildVerificationMessage(code, deviceName);

  if (isMetaWhatsAppConfigured()) {
    return sendViaMeta(phone, message);
  }

  if (isGenericWhatsAppConfigured()) {
    return sendViaGeneric(phone, message);
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[dev] WhatsApp verification for ${phone}: ${message}`);
    return;
  }

  throw new Error('WhatsApp verification is not configured.');
}

module.exports = { sendDeviceRemovalWhatsapp };
