import { redis } from "../lib/redis";

const SPONSORS_KEY = "marathon:sponsors";
const CODES_KEY = "marathon:codes";
const CODES_HISTORY_KEY = "marathon:codes:history";
const SPONSORS_HISTORY_KEY = "marathon:sponsors:history";
const CONTRIBUTORS_KEY = "marathon:contributors";
const CONTRIBUTORS_HISTORY_KEY = "marathon:contributors:history";
const COUNTER_PREFIX = "marathon:contributors:counter:";
const CONTRIBUTORS_BY_KM_PREFIX = "marathon:contributors:by-km:";
const LOCK_PREFIX = "marathon:km-lock:";
const RATE_LIMIT_PREFIX = "marathon:rate:admin:";
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX_REQUESTS = 120;

const NAME_MAX = 40;
const MESSAGE_MAX = 240;
const REASON_MAX = 240;
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

function normalizeAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const rounded = Math.round(parsed * 100) / 100;
  if (rounded < 0 || rounded > MAX_AMOUNT) {
    return null;
  }

  return rounded;
}

function normalizeKm(value) {
  const parsedKm = Number(value);
  if (!Number.isInteger(parsedKm) || parsedKm < 1 || parsedKm > 42) {
    return null;
  }

  return parsedKm;
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

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") {
    return "";
  }

  if (!auth.startsWith("Bearer ")) {
    return "";
  }

  return auth.slice(7).trim();
}

function isAuthorized(req) {
  const configuredToken = process.env.ADMIN_TOKEN;
  if (!configuredToken) {
    return false;
  }

  const headerToken = req.headers["x-admin-token"];
  if (typeof headerToken === "string" && headerToken === configuredToken) {
    return true;
  }

  return getBearerToken(req) === configuredToken;
}

function normalizeSponsorType(value) {
  if (value === "group" || value === "sadaqah_jariyah") {
    return value;
  }
  return "individual";
}

function toAdminSponsorRecord(km, record) {
  return {
    km,
    verificationCode: sanitizeText(record?.verificationCode, 64),
    sponsor_type: normalizeSponsorType(record?.sponsor_type),
    name: sanitizeText(record?.name, NAME_MAX),
    group_name: sanitizeText(record?.group_name, NAME_MAX),
    for_name: sanitizeText(record?.for_name, NAME_MAX),
    from_name: sanitizeText(record?.from_name, NAME_MAX),
    email: sanitizeText(record?.email, 120),
    message: sanitizeText(record?.message, MESSAGE_MAX),
    status: record?.status === "confirmed" ? "confirmed" : "pending",
    primary_amount: Number(record?.primary_amount ?? 85),
    verified_amount: Number(record?.verified_amount ?? 0),
    createdAt: Number(record?.createdAt) || 0,
    expiresAt: Number(record?.expiresAt) || 0
  };
}

function toAdminContributorRecord(record) {
  return {
    contributionCode: sanitizeText(record?.contributionCode, 64),
    km: Number(record?.km) || 0,
    name: sanitizeText(record?.name, NAME_MAX),
    email: sanitizeText(record?.email, 120),
    message: sanitizeText(record?.message, MESSAGE_MAX),
    amount: Number(record?.amount) || 0,
    status: record?.status === "confirmed" ? "confirmed" : "pending",
    createdAt: Number(record?.createdAt) || 0,
    baseVerificationCode: sanitizeText(record?.baseVerificationCode, 64)
  };
}

async function getAdminSnapshot() {
  const [rawSponsors, rawContributors] = await Promise.all([
    redis.hgetall(SPONSORS_KEY),
    redis.hgetall(CONTRIBUTORS_KEY)
  ]);

  const sponsors = {};
  const contributorsByKm = {};

  for (const [kmField, value] of Object.entries(rawSponsors || {})) {
    const km = normalizeKm(kmField);
    const record = parseStoredRecord(value);
    if (!km || !record) {
      continue;
    }

    sponsors[km] = toAdminSponsorRecord(km, record);
  }

  for (const value of Object.values(rawContributors || {})) {
    const record = parseStoredRecord(value);
    if (!record) {
      continue;
    }

    const km = normalizeKm(record.km);
    if (!km) {
      continue;
    }

    if (!contributorsByKm[km]) {
      contributorsByKm[km] = [];
    }

    contributorsByKm[km].push(toAdminContributorRecord(record));
  }

  return {
    sponsors,
    contributorsByKm
  };
}

async function verifySponsor(req, res) {
  const km = normalizeKm(req.body?.km);
  const verifiedAmount = normalizeAmount(req.body?.verified_amount);

  if (!km) {
    return res.status(400).json({ error: "Invalid KM" });
  }

  if (verifiedAmount === null) {
    return res.status(400).json({ error: "Invalid verified amount" });
  }

  const kmField = String(km);
  const current = parseStoredRecord(await redis.hget(SPONSORS_KEY, kmField));
  if (!current) {
    return res.status(404).json({ error: "Sponsor record not found" });
  }

  const updated = {
    ...current,
    status: "confirmed",
    verified_amount: verifiedAmount,
    verifiedAt: Date.now()
  };

  await redis.hset(SPONSORS_KEY, {
    [kmField]: JSON.stringify(updated)
  });

  return res.status(200).json({
    success: true,
    sponsor: toAdminSponsorRecord(km, updated)
  });
}

async function setContributorStatus(req, res) {
  const code = sanitizeText(req.body?.contribution_code, 64);
  const status = req.body?.status === "confirmed" ? "confirmed" : "pending";
  const amount = req.body?.amount;

  if (!code) {
    return res.status(400).json({ error: "Missing contribution code" });
  }

  const current = parseStoredRecord(await redis.hget(CONTRIBUTORS_KEY, code));
  if (!current) {
    return res.status(404).json({ error: "Contributor record not found" });
  }

  let normalizedAmount;
  if (amount !== undefined) {
    normalizedAmount = normalizeAmount(amount);
    if (normalizedAmount === null) {
      return res.status(400).json({ error: "Invalid amount" });
    }
  }

  const updated = {
    ...current,
    status,
    amount: normalizedAmount === null || normalizedAmount === undefined
      ? Number(current.amount) || 0
      : normalizedAmount,
    updatedAt: Date.now()
  };

  await redis.hset(CONTRIBUTORS_KEY, {
    [code]: JSON.stringify(updated)
  });

  return res.status(200).json({
    success: true,
    contributor: toAdminContributorRecord(updated)
  });
}

async function removeContributor(req, res) {
  const code = sanitizeText(req.body?.contribution_code, 64);
  const reason = sanitizeText(req.body?.reason, REASON_MAX) || "Manual contributor reset";

  if (!code) {
    return res.status(400).json({ error: "Missing contribution code" });
  }

  const current = parseStoredRecord(await redis.hget(CONTRIBUTORS_KEY, code));
  if (!current) {
    return res.status(404).json({ error: "Contributor record not found" });
  }

  const km = normalizeKm(current.km);
  if (!km) {
    return res.status(400).json({ error: "Invalid contributor KM" });
  }

  const kmField = String(km);
  const lockKey = `${LOCK_PREFIX}${kmField}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lockResult = await redis.set(lockKey, lockValue, { nx: true, px: 8000 });

  if (lockResult !== "OK") {
    return res.status(409).json({ error: "This KM is currently being updated. Please retry." });
  }

  try {
    const contributorsByKmKey = `${CONTRIBUTORS_BY_KM_PREFIX}${kmField}`;
    const now = Date.now();

    await redis
      .multi()
      .hset(CONTRIBUTORS_HISTORY_KEY, {
        [code]: JSON.stringify({
          ...current,
          archivedAt: now,
          archiveReason: reason
        })
      })
      .hdel(CONTRIBUTORS_KEY, code)
      .srem(contributorsByKmKey, code)
      .exec();

    return res.status(200).json({
      success: true,
      contributionCode: code
    });
  } finally {
    const currentLockValue = await redis.get(lockKey);
    if (currentLockValue === lockValue) {
      await redis.del(lockKey);
    }
  }
}

async function unreserveKm(req, res) {
  const km = normalizeKm(req.body?.km);
  const reason = sanitizeText(req.body?.reason, REASON_MAX);

  if (!km) {
    return res.status(400).json({ error: "Invalid KM" });
  }

  const kmField = String(km);
  const lockKey = `${LOCK_PREFIX}${kmField}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lockResult = await redis.set(lockKey, lockValue, { nx: true, px: 8000 });

  if (lockResult !== "OK") {
    return res.status(409).json({ error: "This KM is currently being updated. Please retry." });
  }

  try {
    const sponsor = parseStoredRecord(await redis.hget(SPONSORS_KEY, kmField));
    if (!sponsor) {
      return res.status(404).json({ error: "Sponsor record not found" });
    }

    if (sponsor.status === "confirmed") {
      return res.status(409).json({ error: "Only pending KM can be unreserved" });
    }

    const contributorsByKmKey = `${CONTRIBUTORS_BY_KM_PREFIX}${kmField}`;
    const indexedContributorCodes = await redis.smembers(contributorsByKmKey);
    const matchingContributors = [];
    const contributorCodes = [];

    if (Array.isArray(indexedContributorCodes) && indexedContributorCodes.length > 0) {
      const lookup = redis.pipeline();
      for (const rawCode of indexedContributorCodes) {
        const code = sanitizeText(rawCode, 64);
        if (!code) {
          continue;
        }

        contributorCodes.push(code);
        lookup.hget(CONTRIBUTORS_KEY, code);
      }

      const values = await lookup.exec();
      for (const value of values) {
        const entry = parseStoredRecord(value);
        if (!entry || normalizeKm(entry.km) !== km) {
          continue;
        }
        matchingContributors.push(entry);
      }
    } else {
      const rawContributors = await redis.hgetall(CONTRIBUTORS_KEY);
      for (const value of Object.values(rawContributors || {})) {
        const entry = parseStoredRecord(value);
        if (!entry) {
          continue;
        }

        if (normalizeKm(entry.km) !== km) {
          continue;
        }

        matchingContributors.push(entry);
        const contributionCode = sanitizeText(entry.contributionCode, 64);
        if (contributionCode) {
          contributorCodes.push(contributionCode);
        }
      }
    }

    const now = Date.now();
    const historyId = `${km}-${now}`;
    const historyRecord = {
      km,
      archivedAt: now,
      reason,
      sponsor,
      contributors: matchingContributors
    };

    const transaction = redis.multi();
    transaction.hset(SPONSORS_HISTORY_KEY, {
      [historyId]: JSON.stringify(historyRecord)
    });

    const code = sanitizeText(sponsor.verificationCode, 64);
    if (code) {
      transaction.hset(CODES_HISTORY_KEY, {
        [code]: kmField
      });
      transaction.hdel(CODES_KEY, code);
    }

    transaction.hdel(SPONSORS_KEY, kmField);

    for (const contributor of matchingContributors) {
      const contributionCode = sanitizeText(contributor.contributionCode, 64);
      if (!contributionCode) {
        continue;
      }

      transaction.hset(CONTRIBUTORS_HISTORY_KEY, {
        [contributionCode]: JSON.stringify({
          ...contributor,
          archivedAt: now,
          archiveReason: reason
        })
      });
      transaction.hdel(CONTRIBUTORS_KEY, contributionCode);
      transaction.srem(contributorsByKmKey, contributionCode);
    }

    for (const contributionCode of contributorCodes) {
      transaction.srem(contributorsByKmKey, contributionCode);
    }

    transaction.del(`${COUNTER_PREFIX}${kmField}`);
    transaction.del(contributorsByKmKey);
    await transaction.exec();

    return res.status(200).json({
      success: true,
      km,
      archivedContributors: matchingContributors.length
    });
  } finally {
    const currentLockValue = await redis.get(lockKey);
    if (currentLockValue === lockValue) {
      await redis.del(lockKey);
    }
  }
}

export default async function handler(req, res) {
  const allowed = await enforceRateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: "Too many admin requests. Please try again shortly." });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    try {
      const data = await getAdminSnapshot();
      return res.status(200).json({ success: true, ...data });
    } catch {
      return res.status(500).json({ error: "Unable to load admin data" });
    }
  }

  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = sanitizeText(req.body?.action, 64);

  if (action === "verify_sponsor") {
    return verifySponsor(req, res);
  }

  if (action === "set_contributor_status") {
    return setContributorStatus(req, res);
  }

  if (action === "unreserve_km") {
    return unreserveKm(req, res);
  }

  if (action === "remove_contributor") {
    return removeContributor(req, res);
  }

  return res.status(400).json({ error: "Invalid admin action" });
}
