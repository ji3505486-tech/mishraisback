// Fresh Telegram webhook endpoint (v2). Aggregate counts only; no member identifiers are stored or sent to Meta.
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET_V2;
  const supplied = String(req.headers["x-telegram-bot-api-secret-token"] || "");
  if (!expected || supplied.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!channelId || !redisUrl || !redisToken) {
    return res.status(503).json({ ok: false, error: "Tracking configuration missing" });
  }

  async function redis(parts) {
    const r = await fetch(redisUrl.replace(/\/$/, "") + "/" + parts.map(encodeURIComponent).join("/"), {
      headers: { Authorization: "Bearer " + redisToken }
    });
    if (!r.ok) throw new Error("Redis unavailable");
    const j = await r.json();
    if (j.error) throw new Error("Redis command failed");
    return j.result;
  }

  const update = req.body || {};
  if (update.update_id === undefined) return res.status(400).json({ ok: false, error: "Missing update_id" });

  try {
    const once = await redis(["SET", "tg:v2:update:" + update.update_id, "1", "EX", "2592000", "NX"]);
    if (once !== "OK") return res.status(200).json({ ok: true, duplicate: true });

    const day = new Date().toISOString().slice(0, 10);
    let eventType = null;

    if (update.chat_join_request &&
        String(update.chat_join_request.chat && update.chat_join_request.chat.id) === String(channelId)) {
      eventType = "join_requests";
    } else if (update.chat_member &&
        String(update.chat_member.chat && update.chat_member.chat.id) === String(channelId)) {
      const oldStatus = update.chat_member.old_chat_member || {};
      const newStatus = update.chat_member.new_chat_member || {};
      const isMember = (m) => ["creator", "administrator", "member"].includes(m.status) ||
        (m.status === "restricted" && m.is_member === true);
      if (!isMember(oldStatus) && isMember(newStatus)) eventType = "accepted_joins";
      else if (isMember(oldStatus) && !isMember(newStatus)) eventType = "leaves";
    }

    if (eventType) {
      const key = "tg:v2:daily:" + day + ":" + eventType;
      await redis(["INCR", key]);
      await redis(["EXPIRE", key, "7776000"]);
      await redis(["INCR", "tg:v2:total:" + eventType]);
      await redis(["LPUSH", "tg:v2:recent", JSON.stringify({ type: eventType, date: day, at: new Date().toISOString() })]);
      await redis(["LTRIM", "tg:v2:recent", "0", "49"]);
    }
    return res.status(200).json({ ok: true, tracked: Boolean(eventType), type: eventType });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Tracking storage temporarily unavailable" });
  }
};
