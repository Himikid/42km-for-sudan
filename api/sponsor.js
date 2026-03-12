import { redis } from "../lib/redis";
import crypto from "crypto";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { km, name, message } = req.body;
  const parsedKm = Number(km);

  if (!name) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (!Number.isInteger(parsedKm) || parsedKm < 1 || parsedKm > 42) {
    return res.status(400).json({ error: "KM must be an integer between 1 and 42" });
  }

  const key = "marathon:sponsors";

  // generate unique verification code
  const id = crypto.randomBytes(4).toString("hex");

  const record = {
    id,
    name,
    message,
    status: "pending"
  };

  const kmField = String(parsedKm);
  const created = await redis.hsetnx(key, kmField, JSON.stringify(record));

  if (created === 0) {
    return res.status(409).json({ error: "KM already reserved" });
  }

  return res.status(200).json({
    success: true,
    verificationCode: id
  });
}
