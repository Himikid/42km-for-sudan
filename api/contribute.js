import { redis } from "../lib/redis";
import { Resend } from "resend";

const SPONSORS_KEY = "marathon:sponsors";
const CONTRIBUTORS_KEY = "marathon:contributors";
const COUNTER_PREFIX = "marathon:contributors:counter:";
const CONTRIBUTORS_BY_KM_PREFIX = "marathon:contributors:by-km:";
const LOCK_PREFIX = "marathon:km-lock:";
const RATE_LIMIT_PREFIX = "marathon:rate:contribute:";
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_REQUESTS = 20;
const FROM_EMAIL = "sponsor@42kmforsudan.com";
const JUSTGIVING_URL = "https://www.justgiving.com/fundraising/ibrahimjaved-6994f535e1c202f790972e93";

const NAME_MAX = 40;
const EMAIL_MAX = 120;
const MESSAGE_MAX = 240;
const MAX_AMOUNT = 10000;

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

function sanitizeText(value, maxLen) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLen);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < 1 || rounded > MAX_AMOUNT) {
    return null;
  }

  return rounded;
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

async function sendContributionEmail({ email, name, km, contributionCode }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const safeName = sanitizeText(name, NAME_MAX) || "there";
  const safeKm = escapeHtml(km);
  const safeCode = escapeHtml(contributionCode).toUpperCase();

  const subject = "Your KM Contribution – 42km for Sudan";
  const text = [
    `Hi ${safeName},`,
    "",
    "Thank you so much for contributing to a sponsored kilometre of 42km for Sudan. Your support genuinely means a lot.",
    "",
    "Your contribution details:",
    `Kilometre: KM ${km}`,
    `Contribution Code: ${contributionCode.toUpperCase()}`,
    "",
    "To complete your contribution, please donate here:",
    JUSTGIVING_URL,
    "",
    "When donating, please include your contribution code in the donation message so I can match your contribution.",
    "",
    "Here is a quick update on the situation in Sudan and why this fundraiser matters:",
    "https://www.youtube.com/watch?v=12OcaORLnTc",
    "",
    "Thank you again for your support",
    "",
    "Warm regards,",
    "Ibrahim"
  ].join("\n");

  const html = `
    <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.5;color:#1F1F1F;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;color:#0F3D2E;">Your KM Contribution</h2>
      <p style="margin:0 0 12px;">Hi ${escapeHtml(safeName)},</p>
      <p style="margin:0 0 12px;">Thank you so much for contributing to a sponsored kilometre of <strong>42km for Sudan</strong>. Your support genuinely means a lot.</p>
      <p style="margin:0 0 6px;">Your contribution details:</p>
      <p style="margin:0 0 6px;"><strong>Kilometre:</strong> KM ${safeKm}</p>
      <p style="margin:0 0 18px;"><strong>Contribution Code:</strong></p>
      <div style="display:inline-block;border:1px solid #d9d9d9;background:#f8f5ef;padding:10px 14px;border-radius:10px;font-family:ui-monospace,Menlo,monospace;font-size:20px;letter-spacing:1px;font-weight:700;color:#0F3D2E;">
        ${safeCode}
      </div>
      <p style="margin:18px 0 10px;">To complete your contribution, please donate here:</p>
      <p style="margin:0 0 18px;"><a href="${JUSTGIVING_URL}" style="color:#0F3D2E;font-weight:600;">Donate on JustGiving</a></p>
      <p style="margin:0 0 14px;">When donating, please include your contribution code in the donation message so I can match your contribution.</p>
      <p style="margin:0 0 8px;">Here is a quick update on the situation in Sudan and why this fundraiser matters:</p>
      <p style="margin:0 0 18px;"><a href="https://www.youtube.com/watch?v=12OcaORLnTc" style="color:#0F3D2E;font-weight:600;">Watch: Sudan Crisis Update</a></p>
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const allowed = await enforceRateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: "Too many attempts. Please try again shortly." });
  }

  const { km, name, email, message, amount } = req.body || {};
  const parsedKm = Number(km);
  const trimmedName = sanitizeText(name, NAME_MAX);
  const trimmedEmail = sanitizeText(email, EMAIL_MAX).toLowerCase();
  const normalizedMessage = sanitizeText(message, MESSAGE_MAX);
  const normalizedAmount = normalizeAmount(amount);

  if (!Number.isInteger(parsedKm) || parsedKm < 1 || parsedKm > 42) {
    return res.status(400).json({ error: "Invalid KM" });
  }

  if (!trimmedName) {
    return res.status(400).json({ error: "Missing name" });
  }

  if (!trimmedEmail || !isValidEmail(trimmedEmail)) {
    return res.status(400).json({ error: "Invalid email" });
  }

  if (normalizedAmount === null) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const kmField = String(parsedKm);
  const lockKey = `${LOCK_PREFIX}${kmField}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lockResult = await redis.set(lockKey, lockValue, { nx: true, px: 5000 });

  if (lockResult !== "OK") {
    return res.status(409).json({ error: "This KM is currently being updated. Please try again." });
  }

  try {
    const sponsorValue = await redis.hget(SPONSORS_KEY, kmField);
    const sponsorRecord = parseStoredRecord(sponsorValue);
    const baseVerificationCode = sponsorRecord?.verificationCode;

    if (!baseVerificationCode) {
      return res.status(404).json({ error: "No sponsored KM found to contribute to" });
    }

    const counterKey = `${COUNTER_PREFIX}${kmField}`;
    const counter = await redis.incr(counterKey);
    const contributionCode = `${baseVerificationCode}-C${counter}`;
    const createdAt = Date.now();

    const contributionRecord = {
      km: parsedKm,
      name: trimmedName,
      email: trimmedEmail,
      message: normalizedMessage,
      amount: normalizedAmount,
      status: "pending",
      baseVerificationCode,
      contributionCode,
      createdAt
    };

    const contributorsByKmKey = `${CONTRIBUTORS_BY_KM_PREFIX}${kmField}`;
    await redis
      .multi()
      .hset(CONTRIBUTORS_KEY, {
        [contributionCode]: JSON.stringify(contributionRecord)
      })
      .sadd(contributorsByKmKey, contributionCode)
      .exec();

    let emailSent = true;
    try {
      await sendContributionEmail({
        email: trimmedEmail,
        name: trimmedName,
        km: parsedKm,
        contributionCode
      });
    } catch (emailError) {
      emailSent = false;
      console.error("Failed to send contribution confirmation email", {
        km: parsedKm,
        email: trimmedEmail,
        message: emailError?.message || "Unknown error"
      });
    }

    return res.status(200).json({
      success: true,
      contributionCode,
      baseVerificationCode,
      emailSent,
      contribution: {
        name: trimmedName,
        amount: normalizedAmount,
        message: normalizedMessage,
        status: "pending",
        createdAt
      }
    });
  } finally {
    const currentLockValue = await redis.get(lockKey);
    if (currentLockValue === lockValue) {
      await redis.del(lockKey);
    }
  }
}
