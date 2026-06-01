const nodemailer = require('nodemailer');

function toBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function allowDevEmailPreview() {
  return process.env.NODE_ENV !== 'production' && toBoolean(process.env.ALLOW_DEV_EMAIL_PREVIEW);
}

const PLACEHOLDER_PATTERNS = [
  'your_email@gmail.com',
  'your_app_password',
  'your_gmail_app_password_here',
  'your_app_password_here',
  'your_emailjs_public_key_here',
  'placeholder',
  'changeme',
];

function isPlaceholder(value) {
  if (!value) return true;
  const lower = value.trim().toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
}

function isEmailJsConfigured() {
  return Boolean(
    process.env.EMAILJS_SERVICE_ID &&
    process.env.EMAILJS_TEMPLATE_ID &&
    process.env.EMAILJS_PUBLIC_KEY &&
    !isPlaceholder(process.env.EMAILJS_PUBLIC_KEY)
  );
}

function isMailConfigured() {
  return Boolean(
    process.env.EMAIL_HOST &&
    process.env.EMAIL_PORT &&
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    !isPlaceholder(process.env.EMAIL_USER) &&
    !isPlaceholder(process.env.EMAIL_PASS)
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

  const purposeIcon = purpose === 'register' ? '🎬' : purpose === 'password_reset' ? '🔐' : '📱';
  const accentColor = '#f59e0b';
  const bgDark = '#080600';
  const bgCard = '#120f02';
  const bgCode = '#1a1500';
  const textMuted = '#8a8070';
  const textBody = '#c8bfa8';
  const border = 'rgba(245,158,11,0.25)';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${copy.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0b01;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d0b01;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Logo header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <div style="width:40px;height:40px;border-radius:50%;background:rgba(245,158,11,0.12);border:1.5px solid rgba(245,158,11,0.35);display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:40px;font-size:18px;">🎬</div>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:18px;font-weight:800;color:#fdf8ee;letter-spacing:1px;">CINEMA</span>
                    <span style="font-size:13px;font-weight:300;color:rgba(253,248,238,0.35);letter-spacing:4px;margin-left:4px;">Rwanda</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:${bgCard};border:1px solid ${border};border-radius:20px;overflow:hidden;">

              <!-- Gold top bar -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:3px;background:linear-gradient(90deg,#d97706,#f59e0b,#fbbf24,#f59e0b,#d97706);"></td>
                </tr>
              </table>

              <!-- Card body -->
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px;">
                <tr>
                  <td>
                    <!-- Icon + heading -->
                    <p style="margin:0 0 6px 0;font-size:28px;text-align:center;">${purposeIcon}</p>
                    <h1 style="margin:0 0 8px 0;font-size:22px;font-weight:800;color:#fdf8ee;text-align:center;letter-spacing:-0.3px;">${copy.heading}</h1>
                    <p style="margin:0 0 28px 0;font-size:13px;color:${textMuted};text-align:center;letter-spacing:0.5px;text-transform:uppercase;">One-Time Password</p>

                    <!-- Greeting -->
                    <p style="margin:0 0 12px 0;font-size:15px;color:${textBody};line-height:1.6;">Hello <strong style="color:#fdf8ee;">${name || 'there'}</strong>,</p>
                    <p style="margin:0 0 28px 0;font-size:14px;color:${textBody};line-height:1.7;">${copy.intro}</p>

                    <!-- OTP Code box -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                      <tr>
                        <td align="center">
                          <div style="display:inline-block;background:${bgCode};border:1.5px solid rgba(245,158,11,0.45);border-radius:12px;padding:18px 36px;">
                            <p style="margin:0 0 6px 0;font-size:10px;font-weight:700;color:${textMuted};letter-spacing:2px;text-transform:uppercase;text-align:center;">Your code</p>
                            <p style="margin:0;font-size:36px;font-weight:900;color:${accentColor};letter-spacing:10px;text-align:center;font-family:'Courier New',Courier,monospace;">${code}</p>
                          </div>
                        </td>
                      </tr>
                    </table>

                    <!-- Expiry notice -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                      <tr>
                        <td style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:8px;padding:12px 16px;">
                          <p style="margin:0;font-size:13px;color:${textMuted};text-align:center;line-height:1.5;">⏱ ${copy.footer}</p>
                        </td>
                      </tr>
                    </table>

                    <!-- Divider -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                      <tr>
                        <td style="border-top:1px solid rgba(255,255,255,0.06);"></td>
                      </tr>
                    </table>

                    <!-- Security note -->
                    <p style="margin:0;font-size:12px;color:${textMuted};line-height:1.6;text-align:center;">
                      🔒 If you didn't request this, you can safely ignore this email.<br/>
                      Never share this code with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Gold bottom bar -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:2px;background:linear-gradient(90deg,transparent,rgba(245,158,11,0.4),transparent);"></td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px 0;font-size:12px;color:rgba(253,248,238,0.2);">© 2025 CINEMA Rwanda · All rights reserved</p>
              <p style="margin:0;font-size:11px;color:rgba(253,248,238,0.15);">The home of Rwandan cinema</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildResetEmailHtml({ resetUrl }) {
  const accentColor = '#f59e0b';
  const bgCard = '#120f02';
  const bgCode = '#1a1500';
  const textMuted = '#8a8070';
  const textBody = '#c8bfa8';
  const border = 'rgba(245,158,11,0.25)';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your CINEMA Rwanda password</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0b01;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d0b01;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <span style="font-size:18px;font-weight:800;color:#fdf8ee;letter-spacing:1px;">CINEMA</span>
              <span style="font-size:13px;font-weight:300;color:rgba(253,248,238,0.35);letter-spacing:4px;margin-left:4px;">Rwanda</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:${bgCard};border:1px solid ${border};border-radius:20px;overflow:hidden;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="height:3px;background:linear-gradient(90deg,#d97706,#f59e0b,#fbbf24,#f59e0b,#d97706);"></td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px;">
                <tr>
                  <td>
                    <p style="margin:0 0 6px 0;font-size:28px;text-align:center;">🔐</p>
                    <h1 style="margin:0 0 24px 0;font-size:22px;font-weight:800;color:#fdf8ee;text-align:center;">Reset your password</h1>
                    <p style="margin:0 0 24px 0;font-size:14px;color:${textBody};line-height:1.7;text-align:center;">Click the button below to reset your CINEMA Rwanda password. This link expires in <strong style="color:#fdf8ee;">1 hour</strong>.</p>

                    <!-- CTA Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                      <tr>
                        <td align="center">
                          <a href="${resetUrl}" style="display:inline-block;background:${accentColor};color:#000;padding:14px 36px;border-radius:10px;font-weight:800;text-decoration:none;font-size:15px;letter-spacing:0.3px;">Reset Password</a>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback URL -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                      <tr>
                        <td style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:8px;padding:12px 16px;">
                          <p style="margin:0 0 4px 0;font-size:11px;color:${textMuted};text-transform:uppercase;letter-spacing:1px;">Or copy this link</p>
                          <p style="margin:0;font-size:11px;color:${accentColor};word-break:break-all;">${resetUrl}</p>
                        </td>
                      </tr>
                    </table>

                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                      <tr><td style="border-top:1px solid rgba(255,255,255,0.06);"></td></tr>
                    </table>
                    <p style="margin:0;font-size:12px;color:${textMuted};line-height:1.6;text-align:center;">🔒 If you didn't request this, ignore this email. Your password won't change.</p>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="height:2px;background:linear-gradient(90deg,transparent,rgba(245,158,11,0.4),transparent);"></td></tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px 0;font-size:12px;color:rgba(253,248,238,0.2);">© 2025 CINEMA Rwanda · All rights reserved</p>
              <p style="margin:0;font-size:11px;color:rgba(253,248,238,0.15);">The home of Rwandan cinema</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    // Always log OTP to console in dev so you can test without real SMTP
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📧  [DEV EMAIL] To: ${to}`);
      console.log(`    Subject: ${subject}`);
      if (text) console.log(`    Body: ${text}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return; // silently succeed in dev
    }

    throw new Error(
      'SMTP email delivery is not configured. ' +
      'Set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, and EMAIL_PASS in your .env file. ' +
      'For Gmail, generate an App Password at myaccount.google.com/security.'
    );
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
      const canFallbackToSmtp = isMailConfigured() || allowDevEmailPreview();
      if (!canFallbackToSmtp) {
        throw error;
      }

      console.warn(`EmailJS delivery failed. Falling back to SMTP. ${error.message}`);
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
  if (!isMailConfigured() && process.env.NODE_ENV !== 'production') {
    console.log(`\n📧  [DEV EMAIL] Password reset for ${to}: ${resetUrl}\n`);
    return;
  }

  await sendViaSmtp({
    to,
    subject: 'Reset your CINEMA Rwanda password',
    html: buildResetEmailHtml({ resetUrl }),
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
