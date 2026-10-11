/* POST /api/request-trial — a prospect asks for a 7-day Weektally trial.

   Stores the request in an Azure Table (Sweden Central) and emails Peter a
   plain-text copy via Azure Communication Services. Trials are issued by
   hand; nothing here creates an account or touches the app.

   Everything submitted is untrusted: it is length-limited, validated, stored
   as plain strings and sent only as plain text (never HTML). Bots are turned
   away by a honeypot field, a minimum time on the page (when the page's
   script supplied it) and at most 3 requests an hour per client, keyed by a
   salted hash of the IP — the IP itself is never stored.

   App settings (Static Web App → Environment variables):
     TRIALS_STORAGE_CONNECTION  storage account connection string
     ACS_CONNECTION             Communication Services connection string
     ACS_SENDER                 e.g. DoNotReply@<guid>.azurecomm.net
     NOTIFY_TO                  where requests are emailed
     RATE_SALT                  random string for the IP hash */

const crypto = require('crypto');
const { TableClient } = require('@azure/data-tables');
const { EmailClient } = require('@azure/communication-email');

const TABLE = 'trialrequests';
const RATE_TABLE = 'trialrate';
const MAX_PER_HOUR = 3;
const MIN_MS_ON_PAGE = 3000;
const SIZES = ['1-10', '11-50', '51-200', '201+'];
const LIMITS = { name: 100, email: 254, company: 120, size: 10, note: 1000 };
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/** The body arrives as a urlencoded form (no-JS post) or JSON (fetch). */
function readFields(req) {
  const type = (req.headers['content-type'] || '').toLowerCase();
  if (type.includes('application/json')) {
    return typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.rawBody || '{}');
  }
  return Object.fromEntries(new URLSearchParams(req.rawBody || ''));
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max + 1);

function validate(f) {
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) out[k] = clean(f[k], max);
  for (const [k, max] of Object.entries(LIMITS)) if (out[k].length > max) return { error: `${k} is too long` };
  if (!out.name) return { error: 'Please give your name.' };
  if (!EMAIL_RE.test(out.email)) return { error: 'Please give a valid work email.' };
  if (!out.company) return { error: 'Please give your company.' };
  if (out.size && !SIZES.includes(out.size)) return { error: 'Please pick a team size.' };
  return { value: out };
}

function clientIp(req) {
  const h = req.headers;
  const raw = h['x-azure-clientip'] || (h['x-forwarded-for'] || '').split(',')[0] || h['client-ip'] || '';
  return raw.trim().replace(/:\d+$/, '');   // drop a port if present
}

/** Count this client's requests in the current hour. Returns false once the
 *  limit is reached. Best effort: a storage hiccup must not block a person. */
async function underRateLimit(req) {
  const conn = process.env.TRIALS_STORAGE_CONNECTION;
  const key = crypto.createHash('sha256').update((process.env.RATE_SALT || '') + clientIp(req)).digest('hex').slice(0, 32);
  const hour = new Date().toISOString().slice(0, 13);            // 2026-10-11T21
  const table = TableClient.fromConnectionString(conn, RATE_TABLE);
  await table.createTable().catch(() => {});
  let count = 0;
  try { count = (await table.getEntity(hour, key)).count || 0; } catch { /* first this hour */ }
  if (count >= MAX_PER_HOUR) return false;
  await table.upsertEntity({ partitionKey: hour, rowKey: key, count: count + 1 }, 'Replace');
  return true;
}

function reply(context, req, status, message) {
  const wantsJson = (req.headers.accept || '').includes('application/json');
  if (wantsJson) {
    context.res = { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
                    body: JSON.stringify({ ok: status < 300, message }) };
  } else {
    // No-JS form post: back to the page, which shows the outcome.
    const q = status < 300 ? 'sent=1' : 'error=' + encodeURIComponent(message);
    context.res = { status: 303, headers: { Location: `/demo.html?${q}#request`, 'Cache-Control': 'no-store' } };
  }
}

module.exports = async function (context, req) {
  let fields;
  try { fields = readFields(req); } catch { return reply(context, req, 400, 'That request could not be read.'); }

  // Honeypot and timing: answer as if it worked, so a bot learns nothing.
  if (clean(fields.website, 200)) return reply(context, req, 200, 'Thanks — we will be in touch.');
  const shown = Number(fields.t);
  if (Number.isFinite(shown) && shown > 0 && shown < MIN_MS_ON_PAGE) {
    return reply(context, req, 200, 'Thanks — we will be in touch.');
  }

  const { value, error } = validate(fields);
  if (error) return reply(context, req, 400, error);

  try {
    if (!(await underRateLimit(req))) {
      return reply(context, req, 429, 'Too many requests from here — please try again in an hour.');
    }
  } catch (e) {
    context.log.warn('rate limit check failed', e.message);
  }

  const at = new Date();
  const id = at.toISOString().replace(/[-:.TZ]/g, '') + '-' + crypto.randomBytes(3).toString('hex');
  try {
    const table = TableClient.fromConnectionString(process.env.TRIALS_STORAGE_CONNECTION, TABLE);
    await table.createTable().catch(() => {});
    await table.createEntity({ partitionKey: at.toISOString().slice(0, 7), rowKey: id, ...value, status: 'new' });
  } catch (e) {
    context.log.error('could not store request', e.message);
    return reply(context, req, 500, 'Something went wrong on our side — please email us instead.');
  }

  try {
    const mail = new EmailClient(process.env.ACS_CONNECTION);
    const poller = await mail.beginSend({
      senderAddress: process.env.ACS_SENDER,
      recipients: { to: [{ address: process.env.NOTIFY_TO }] },
      content: {
        subject: `Weektally trial request — ${value.company}`.slice(0, 150),
        plainText: [
          'A trial was requested on weektally.com.', '',
          `Name:      ${value.name}`,
          `Email:     ${value.email}`,
          `Company:   ${value.company}`,
          `Team size: ${value.size || '—'}`, '',
          'Note:', value.note || '—', '',
          `Stored as ${TABLE}/${id}.`
        ].join('\n')
      },
      replyTo: [{ address: value.email }]
    });
    await poller.pollUntilDone();
  } catch (e) {
    // Stored already, so the request is not lost; Peter can still find it.
    context.log.error('notification email failed', e.message);
  }

  return reply(context, req, 200, 'Thanks — we will be in touch within two working days.');
};
