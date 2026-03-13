import { redis } from "../lib/redis";

const SPONSORS_KEY = "marathon:sponsors";
const CONTRIBUTORS_KEY = "marathon:contributors";
const COUNTER_PREFIX = "marathon:contributors:counter:";
const CONTRIBUTORS_BY_KM_PREFIX = "marathon:contributors:by-km:";
const LOCK_PREFIX = "marathon:km-lock:";
const RATE_LIMIT_PREFIX = "marathon:rate:contribute:";
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_REQUESTS = 20;

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

    return res.status(200).json({
      success: true,
      contributionCode,
      baseVerificationCode,
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
