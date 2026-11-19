// Contact form handler (Vercel Node function).
//
// The recipient address and the email API key live in Vercel environment
// variables, so neither appears in this public repo or in the browser.
//
// Required env vars (Vercel > Project > Settings > Environment Variables):
//   RESEND_API_KEY  API key from https://resend.com
//   CONTACT_TO      address that receives messages
// Optional:
//   CONTACT_FROM    verified sender, e.g. "Consequence Games <hello@consequence.games>"
//                   defaults to Resend's test sender, which only delivers to the
//                   email address that owns the Resend account.

const MAX = { name: 100, email: 200, message: 5000 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const ALLOWED_HOSTS = new Set(['consequence.games', 'www.consequence.games']);

function clean(v, max) {
  if (typeof v !== 'string') return '';
  // strip control chars except newline/tab, trim, cap length
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function originAllowed(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_HOSTS.has(host)
      || (host.startsWith('consequence-games') && host.endsWith('-david-nellis-projects.vercel.app'))
      || host === 'localhost';
  } catch {
    return false;
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const body = await readBody(req);

  // Honeypot: real people never see or fill this field. Pretend success for bots.
  if (clean(body.website, 200)) {
    return res.status(200).json({ ok: true });
  }

  const name = clean(body.name, MAX.name);
  const email = clean(body.email, MAX.email);
  const message = clean(body.message, MAX.message);

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
  }
  if (message.length < 2) {
    return res.status(400).json({ ok: false, error: 'Please write a message.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO;
  const from = process.env.CONTACT_FROM || 'Consequence Games <onboarding@resend.dev>';
  if (!apiKey || !to) {
    console.error('contact: RESEND_API_KEY or CONTACT_TO is not set');
    return res.status(500).json({ ok: false, error: 'Contact form is not set up yet.' });
  }

  const subjectName = (name || email).replace(/[\r\n]+/g, ' ');
  const text = `From: ${name || '(no name)'} <${email}>\n\n${message}\n`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `consequence.games message from ${subjectName}`.slice(0, 160),
        text,
      }),
    });
    if (!r.ok) {
      console.error('contact: Resend error', r.status, await r.text());
      return res.status(502).json({ ok: false, error: 'Could not send right now. Please try again later.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact: send failed', err);
    return res.status(502).json({ ok: false, error: 'Could not send right now. Please try again later.' });
  }
};
