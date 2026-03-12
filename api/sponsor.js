import { redis } from "../lib/redis";

const SPONSORS_KEY = "marathon:sponsors";
const CODES_KEY = "marathon:codes";
const CODES_HISTORY_KEY = "marathon:codes:history";
const LOCK_PREFIX = "marathon:km-lock:";

// adds expired record to history, and deletes from code hash
async function archiveExpiredCode(km, expiredRecord, codesKey, historyKey) {
  const oldCode = expiredRecord.verificationCode;
  if (!oldCode) {
    return;
  }

  await redis.hset(
    historyKey,
    oldCode,
    JSON.stringify({
      km,
      name: expiredRecord.name,
      status: "expired",
      expiredAt: expiredRecord.expiresAt
    })
  );

  await redis.hdel(codesKey, oldCode);
}

function generateVerificationCode(km) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";

  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }

  return `${km}-${suffix}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Post request to reserve a kilometer for sponsorship
  if (req.method === "POST") {
    // input fields
    const { km, name, message } = req.body || {};
    const parsedKm = Number(km);
    const trimmedName = typeof name === "string" ? name.trim() : "";
    const normalizedMessage = typeof message === "string" ? message.trim() : "";
    const now = Date.now();

    // fail fast if missing required fields
    if (!Number.isInteger(parsedKm) || parsedKm < 1 || parsedKm > 42) {
      return res.status(400).json({ error: "Invalid KM" });
    }

    if (!trimmedName) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const kmField = String(parsedKm);
    const lockKey = `${LOCK_PREFIX}${kmField}`;
    const lockValue = `${now}-${Math.random().toString(36).slice(2)}`;
    const lockResult = await redis.set(lockKey, lockValue, { nx: true, px: 5000 });

    // Prevent concurrent reserve attempts for the same KM.
    if (lockResult !== "OK") {
      return res.status(409).json({ error: "This KM is currently reserved." });
    }

    // get existing reservation for this km and run logic (confirmed, pending, available)
    try {
      const existing = await redis.hget(SPONSORS_KEY, kmField);
      const record = existing ? JSON.parse(existing) : null;

      if (record && record.status === "confirmed") {
        return res.status(409).json({
          error: "This KM has already been sponsored."
        });
      }

      if (record && record.status === "pending" && record.expiresAt > now) {
        return res.status(409).json({
          error: "This KM is currently reserved."
        });
      }

      if (record && record.status === "pending" && record.expiresAt <= now) {
        await archiveExpiredCode(kmField, record, CODES_KEY, CODES_HISTORY_KEY);
      }

      // create new record
      const verificationCode = generateVerificationCode(parsedKm);
      const newRecord = {
        verificationCode,
        name: trimmedName,
        message: normalizedMessage,
        status: "pending",
        expiresAt: now + 3 * 60 * 60 * 1000
      };

      await redis.hset(
        SPONSORS_KEY,
        kmField,
        JSON.stringify(newRecord)
      );

      await redis.hset(
        CODES_KEY,
        verificationCode,
        kmField
      );

      return res.status(200).json({
        success: true,
        verificationCode
      });
    } finally {
      const currentLockValue = await redis.get(lockKey);
      if (currentLockValue === lockValue) {
        await redis.del(lockKey);
      }
    }
  }
}
