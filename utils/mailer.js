const nodemailer = require('nodemailer');

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function allowDevEmailPreview() {
  return process.env.NODE_ENV !== 'production' && toBoolean(process.env.ALLOW_DEV_EMAIL_PREVIEW);
}

function isEmailJsConfigured() {
  return Boolean(
    process.env.EMAILJS_SERVICE_ID &&
    process.env.EMAILJS_TEMPLATE_ID &&
    process.env.EMAILJS_PUBLIC_KEY
  );
}

function isMailConfigured() {
  return Boolean(
    process.env.EMAIL_HOST &&
    process.env.EMAIL_PORT &&
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    process.env.EMAIL_USER !== 'your_email@gmail.com' &&
    process.env.EMAIL_PASS !== 'your_app_password'
  );
}

function getTransportConfig() {
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = process.env.EMAIL_SECURE === undefined
    ? port === 465
    : toBoolean(process.env.EMAIL_SECURE);

  return {
    host: process.env.EMAIL_HOST,
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    requireTLS: toBoolean(process.env.EMAIL_REQUIRE_TLS),
  };
}

function getFromAddress() {
  return process.env.EMAIL_FROM || `"CINEMA Rwanda" <${process.env.EMAIL_USER}>`;
}

let cachedTransporter = null;

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(getTransportConfig());
  }

  return cachedTransporter;
}

function buildOtpCopy({ purpose, code, deviceName, expiresInMinutes = 10 }) {
  if (purpose === 'register') {
    return {
      subject: 'Verify your CINEMA Rwanda account',
      heading: 'Confirm your email address',
      intro: 'Use this one-time password to finish creating your CINEMA Rwanda account.',
      footer: `This code expires in ${expiresInMinutes} minutes.`,
      actionLabel: 'Sign up',
      plainText: `Your CINEMA Rwanda sign-up code is ${code}. It expires in ${expiresInMinutes} minutes.`,
    };
  }

  if (purpose === 'password_reset') {
    return {
      subject: 'Your CINEMA Rwanda password reset code',
      heading: 'Reset your password',
      intro: 'Enter this one-time password to reset your CINEMA Rwanda password.',
      footer: `This code expires in ${expiresInMinutes} minutes. If you did not request it, you can ignore this email.`,
      actionLabel: 'Reset password',
      plainText: `Your CINEMA Rwanda password reset code is ${code}. It expires in ${expiresInMinutes} minutes.`,
    };
  }

  return {
    subject: 'Verify device removal for CINEMA Rwanda',
    heading: 'Confirm device removal',
    intro: `Use this one-time password to remove ${deviceName ? `"${deviceName}"` : 'the selected device'} from your CINEMA Rwanda account.`,
    footer: `This code expires in ${expiresInMinutes} minutes.`,
    actionLabel: 'Remove device',
    plainText: `Your CINEMA Rwanda device removal code is ${code}. It expires in ${expiresInMinutes} minutes.`,
  };
}

function buildOtpTemplateParams({ to, name, code, purpose, deviceName, expiresInMinutes = 10 }) {
  const copy = buildOtpCopy({ purpose, code, deviceName, expiresInMinutes });

  return {
    to_email: to,
    email: to,
    recipient_email: to,
    to_name: name || 'CINEMA Rwanda user',
    name: name || 'CINEMA Rwanda user',
    user_name: name || 'CINEMA Rwanda user',
    otp_code: code,
    otp: code,
    passcode: code,
    verification_code: code,
    code,
    otp_purpose: purpose,
    purpose,
    action: copy.actionLabel,
    action_text: copy.actionLabel,
    subject: copy.subject,
    title: copy.heading,
    heading: copy.heading,
    message: copy.intro,
    intro: copy.intro,
    footer: copy.footer,
    expires_in_minutes: expiresInMinutes,
    expiresInMinutes,
    device_name: deviceName || '',
    app_name: 'CINEMA Rwanda',
    support_email: process.env.EMAIL_USER || 'support@cinemarwanda.local',
  };
}

function buildOtpEmailHtml({ name, code, purpose, deviceName, expiresInMinutes = 10 }) {
  const copy = buildOtpCopy({ purpose, code, deviceName, expiresInMinutes });

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a0a;color:#fff;padding:2rem;border-radius:12px;">
      <p style="color:#22c55e;letter-spacing:0.18em;text-transform:uppercase;font-size:0.72rem;margin-bottom:0.8rem;">CINEMA Rwanda</p>
      <h2 style="font-size:1.4rem;margin-bottom:0.5rem;">${copy.heading}</h2>
      <p style="color:#b7c2ba;margin-bottom:1rem;">Hello ${name || 'there'},</p>
      <p style="color:#d0d6d2;margin-bottom:1.25rem;line-height:1.6;">${copy.intro}</p>
      <div style="display:inline-block;background:#151f18;border:1px solid rgba(34,197,94,0.3);padding:14px 18px;font-size:1.6rem;letter-spacing:0.35rem;font-weight:700;">
        ${code}
      </div>
      <p style="color:#777;font-size:0.82rem;margin-top:1.25rem;line-height:1.6;">${copy.footer}</p>
    </div>
  `;
}

async function sendViaEmailJs(templateParams) {
  const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY || undefined,
      template_params: templateParams,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`EmailJS delivery failed: ${details}`);
  }
}

async function sendViaSmtp({ to, subject, html, text }) {
  if (!isMailConfigured()) {
    if (allowDevEmailPreview()) {
      console.log(`[dev] Email for ${to}: ${subject}`);
      if (text) {
        console.log(text);
      }
      return;
    }

    throw new Error('SMTP email delivery is not configured.');
  }

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject,
    html,
    text,
  });
}

async function sendOneTimePasswordEmail({ to, name, code, purpose, deviceName, expiresInMinutes = 10 }) {
  const copy = buildOtpCopy({ purpose, code, deviceName, expiresInMinutes });
  const templateParams = buildOtpTemplateParams({
    to,
    name,
    code,
    purpose,
    deviceName,
    expiresInMinutes,
  });

  if (isEmailJsConfigured()) {
    try {
      return await sendViaEmailJs(templateParams);
    } catch (error) {
      if (!allowDevEmailPreview()) {
        throw error;
      }

      // Local development should keep moving even when EmailJS cannot be reached.
      console.warn(`[dev] EmailJS delivery failed. Falling back to local preview. ${error.message}`);
    }
  }

  return sendViaSmtp({
    to,
    subject: copy.subject,
    html: buildOtpEmailHtml({ name, code, purpose, deviceName, expiresInMinutes }),
    text: copy.plainText,
  });
}

async function sendResetEmail(to, resetUrl) {
  if (!isMailConfigured() && allowDevEmailPreview()) {
    console.log(`[dev] Password reset email for ${to}: ${resetUrl}`);
    return;
  }

  await sendViaSmtp({
    to,
    subject: 'Reset your CINEMA Rwanda password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a0a;color:#fff;padding:2rem;border-radius:12px;">
        <h2 style="font-size:1.4rem;margin-bottom:0.5rem;">Reset your password</h2>
        <p style="color:#888;margin-bottom:1.5rem;">Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}"
          style="display:inline-block;background:#1db954;color:#000;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;font-size:0.95rem;">
          Reset Password
        </a>
        <p style="color:#555;font-size:0.8rem;margin-top:1.5rem;">If you didn't request this, ignore this email. Your password won't change.</p>
        <p style="color:#555;font-size:0.75rem;">Or copy this link: ${resetUrl}</p>
      </div>
    `,
    text: `Reset your CINEMA Rwanda password using this link: ${resetUrl}`,
  });
}

async function sendDeviceRemovalEmail(to, code, deviceName) {
  return sendOneTimePasswordEmail({
    to,
    code,
    purpose: 'device_removal',
    deviceName,
  });
}

module.exports = {
  isEmailJsConfigured,
  isMailConfigured,
  sendDeviceRemovalEmail,
  sendOneTimePasswordEmail,
  sendResetEmail,
};
