import { redis } from "../lib/redis";
import { Resend } from "resend";

const SPONSORS_KEY = "marathon:sponsors";
const CODES_KEY = "marathon:codes";
const CONTRIBUTORS_KEY = "marathon:contributors";
const LOCK_PREFIX = "marathon:km-lock:";
const RATE_LIMIT_PREFIX = "marathon:rate:sponsor:";
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_REQUESTS = 12;
const FROM_EMAIL = "sponsor@42kmforsudan.com";
const JUSTGIVING_URL = "https://www.justgiving.com/fundraising/ibrahimjaved-6994f535e1c202f790972e93";

const NAME_MAX = 40;
const EMAIL_MAX = 120;
const MESSAGE_MAX = 240;
const MAX_PRIMARY_AMOUNT = 10000;

function parseStoredRecord(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return null;
}

function generateVerificationCode(km) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";

  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }

  return `KM${km}-${suffix}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeSponsorType(value) {
  if (value === "group" || value === "sadaqah_jariyah") {
    return value;
  }
  return "individual";
}

function getClientIp(req) {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (typeof xForwardedFor === "string" && xForwardedFor.trim()) {
    return xForwardedFor.split(",")[0].trim();
  }

  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    return xForwardedFor[0];
  }

  return req.headers["x-real-ip"] || "unknown";
}

async function enforceRateLimit(req) {
  const ip = getClientIp(req);
  const key = `${RATE_LIMIT_PREFIX}${ip}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }

  return count <= RATE_LIMIT_MAX_REQUESTS;
}

function sanitizeText(value, maxLen) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLen);
}

function normalizePrimaryAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < 85 || rounded > MAX_PRIMARY_AMOUNT) {
    return null;
  }

  return rounded;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendReservationEmail({ email, km, verificationCode, displayName }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const safeDisplayName = sanitizeText(displayName, NAME_MAX) || "there";
  const safeCode = escapeHtml(verificationCode).toUpperCase();
  const safeKm = escapeHtml(km);

  const subject = "Your KM Reservation – 42km for Sudan";
  const text = [
    `Hi ${safeDisplayName},`,
    "",
    "Thank you so much for sponsoring a kilometre of 42km for Sudan. Your support genuinely means a lot.",
    "",
    "You have reserved:",
    `Kilometre: KM ${km}`,
    `Verification Code: ${verificationCode.toUpperCase()}`,
    "",
    "To complete your sponsorship, please donate here:",
    JUSTGIVING_URL,
    "",
    "When donating, please include your verification code in the donation message so I can match your contribution to your kilometre.",
    "",
    "Here is a quick update on the situation in Sudan and why this fundraiser matters:",
    "https://www.youtube.com/watch?v=12OcaORLnTc",
    "",
    "If you have any questions, feel free to contact me at Ibrahim@andalus.co.uk.",
    "",
    "Thank you again for your support",
    "",
    "Warm regards,",
    "Ibrahim"
  ].join("\n");

  const html = `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.5;color:#1F1F1F;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;color:#0F3D2E;">Your KM Reservation</h2>
      <p style="margin:0 0 12px;">Hi ${escapeHtml(safeDisplayName)},</p>
      <p style="margin:0 0 12px;">Thank you so much for sponsoring a kilometre of <strong>42km for Sudan</strong>. Your support genuinely means a lot.</p>
      <p style="margin:0 0 6px;">You have reserved:</p>
      <p style="margin:0 0 6px;"><strong>Kilometre:</strong> KM ${safeKm}</p>
      <p style="margin:0 0 18px;"><strong>Verification Code:</strong></p>
      <div style="display:inline-block;border:1px solid #d9d9d9;background:#f8f5ef;padding:10px 14px;border-radius:10px;font-family:ui-monospace,Menlo,monospace;font-size:20px;letter-spacing:1px;font-weight:700;color:#0F3D2E;">
        ${safeCode}
      </div>
      <p style="margin:18px 0 10px;">To complete your sponsorship, please donate here:</p>
      <p style="margin:0 0 18px;"><a href="${JUSTGIVING_URL}" style="color:#0F3D2E;font-weight:600;">Donate on JustGiving</a></p>
      <p style="margin:0 0 14px;">When donating, please include your verification code in the donation message so I can match your contribution to your kilometre.</p>
      <p style="margin:0 0 8px;">Here is a quick update on the situation in Sudan and why this fundraiser matters:</p>
      <p style="margin:0 0 18px;"><a href="https://www.youtube.com/watch?v=12OcaORLnTc" style="color:#0F3D2E;font-weight:600;">Watch: Sudan Crisis Update</a></p>
      <p style="margin:0 0 12px;">If you have any questions, feel free to contact me at <a href="mailto:Ibrahim@andalus.co.uk" style="color:#0F3D2E;font-weight:600;">Ibrahim@andalus.co.uk</a>.</p>
      <p style="margin:0;">Thank you again for your support</p>
      <p style="margin:10px 0 0;">Warm regards,<br />Ibrahim</p>
    </div>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject,
    text,
    html
  });
}

function parseContributorsByKm(rawContributors) {
  const contributorsByKm = {};

  for (const value of Object.values(rawContributors || {})) {
    const record = parseStoredRecord(value);
    if (!record) {
      continue;
    }

    const km = Number(record.km);
    if (!Number.isInteger(km) || km < 1 || km > 42) {
      continue;
    }

    if (!contributorsByKm[km]) {
      contributorsByKm[km] = [];
    }

    contributorsByKm[km].push({
      name: sanitizeText(record.name, NAME_MAX) || "Contributor",
      amount: Number(record.amount) || 0,
      message: sanitizeText(record.message, MESSAGE_MAX),
      status: record.status === "confirmed" ? "confirmed" : "pending"
    });
  }

  return contributorsByKm;
}

function toPublicSponsorRecord(record) {
  return {
    verificationCode: sanitizeText(record?.verificationCode, 64),
    sponsor_type: normalizeSponsorType(record?.sponsor_type),
    name: sanitizeText(record?.name, NAME_MAX),
    group_name: sanitizeText(record?.group_name, NAME_MAX),
    for_name: sanitizeText(record?.for_name, NAME_MAX),
    from_name: sanitizeText(record?.from_name, NAME_MAX),
    message: sanitizeText(record?.message, MESSAGE_MAX),
    status: record?.status === "confirmed" ? "confirmed" : "pending",
    primary_amount: Number(record?.primary_amount ?? 85),
    verified_amount: Number(record?.verified_amount ?? 0),
    createdAt: Number(record?.createdAt) || 0,
    expiresAt: Number(record?.expiresAt) || 0
  };
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const [rawSponsors, rawContributors] = await Promise.all([
        redis.hgetall(SPONSORS_KEY),
        redis.hgetall(CONTRIBUTORS_KEY)
      ]);

      const sponsors = {};
      for (const [kmField, value] of Object.entries(rawSponsors || {})) {
        const km = Number(kmField);
        const record = parseStoredRecord(value);

        if (!Number.isInteger(km) || km < 1 || km > 42 || !record) {
          continue;
        }

        sponsors[km] = toPublicSponsorRecord(record);
      }

      return res.status(200).json({
        success: true,
        sponsors,
        contributorsByKm: parseContributorsByKm(rawContributors)
      });
    } catch {
      return res.status(500).json({ error: "Unable to load sponsor data" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const allowed = await enforceRateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: "Too many attempts. Please try again shortly." });
  }

  const { km, sponsor_type, name, group_name, for_name, from_name, email, amount, message } = req.body || {};
  const parsedKm = Number(km);
  const normalizedSponsorType = normalizeSponsorType(sponsor_type);
  const trimmedName = sanitizeText(name, NAME_MAX);
  const trimmedGroupName = sanitizeText(group_name, NAME_MAX);
  const trimmedForName = sanitizeText(for_name, NAME_MAX);
  const trimmedFromName = sanitizeText(from_name, NAME_MAX);
  const trimmedEmail = sanitizeText(email, EMAIL_MAX).toLowerCase();
  const normalizedAmount = normalizePrimaryAmount(amount);
  const normalizedMessage = sanitizeText(message, MESSAGE_MAX);
  const now = Date.now();

  if (!Number.isInteger(parsedKm) || parsedKm < 1 || parsedKm > 42) {
    return res.status(400).json({ error: "Invalid KM" });
  }

  if (normalizedSponsorType === "individual" && !trimmedName) {
    return res.status(400).json({ error: "Missing name" });
  }

  if (normalizedSponsorType === "group" && !trimmedGroupName) {
    return res.status(400).json({ error: "Missing group name" });
  }

  if (normalizedSponsorType === "sadaqah_jariyah" && (!trimmedForName || !trimmedFromName)) {
    return res.status(400).json({ error: "Missing sadaqah fields" });
  }

  if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  if (normalizedAmount === null) {
    return res.status(400).json({ error: "Invalid sponsorship amount. Minimum is £85." });
  }

  const kmField = String(parsedKm);
  const lockKey = `${LOCK_PREFIX}${kmField}`;
  const lockValue = `${now}-${Math.random().toString(36).slice(2)}`;
  const lockResult = await redis.set(lockKey, lockValue, { nx: true, px: 5000 });

  if (lockResult !== "OK") {
    return res.status(409).json({ error: "This KM is currently reserved." });
  }

  try {
    const existing = await redis.hget(SPONSORS_KEY, kmField);
    const existingRecord = parseStoredRecord(existing);

    if (existingRecord) {
      return res.status(409).json({ error: "This KM is currently reserved." });
    }

    let verificationCode;
    do {
      verificationCode = generateVerificationCode(parsedKm);
    } while (await redis.hexists(CODES_KEY, verificationCode));

    const newRecord = {
      verificationCode,
      sponsor_type: normalizedSponsorType,
      name: trimmedName,
      group_name: trimmedGroupName,
      for_name: trimmedForName,
      from_name: trimmedFromName,
      email: trimmedEmail,
      message: normalizedMessage,
      status: "pending",
      primary_amount: normalizedAmount,
      verified_amount: 0,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000
    };

    await redis
      .multi()
      .hset(SPONSORS_KEY, {
        [kmField]: JSON.stringify(newRecord)
      })
      .hset(CODES_KEY, {
        [verificationCode]: kmField
      })
      .exec();

    let emailSent = true;
    try {
      const displayName = trimmedName || trimmedGroupName || trimmedFromName || "there";
      await sendReservationEmail({
        email: trimmedEmail,
        km: parsedKm,
        verificationCode,
        displayName
      });
    } catch (emailError) {
      emailSent = false;
      console.error("Failed to send sponsor confirmation email", {
        km: parsedKm,
        email: trimmedEmail,
        message: emailError?.message || "Unknown error"
      });
    }

    return res.status(200).json({
      success: true,
      verificationCode,
      emailSent
    });
  } finally {
    const currentLockValue = await redis.get(lockKey);
    if (currentLockValue === lockValue) {
      await redis.del(lockKey);
    }
  }
}
