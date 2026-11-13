// Telegram membership webhook for a private channel.
// Required env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// TELEGRAM_CHANNEL_ID, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const supplied = String(req.headers["x-telegram-bot-api-secret-token"] || "");
  if (!secret || supplied.length !== secret.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!channelId || !redisUrl || !redisToken) {
    return res.status(503).json({ ok: false, error: "Telegram tracking is not configured" });
  }

  const update = req.body || {};
  const updateId = update.update_id;
  if (updateId === undefined) return res.status(400).json({ ok: false, error: "Missing update_id" });

  async function redis(command) {
    const r = await fetch(redisUrl.replace(/\/$/, "") + "/" + command.map(encodeURIComponent).join("/"), {
      headers: { Authorization: "Bearer " + redisToken }
    });
    if (!r.ok) throw new Error("Redis request failed");
    const j = await r.json();
    if (j.error) throw new Error("Redis command failed");
    return j.result;
  }

  const memberStatus = (m) => {
    if (!m) return false;
    if (m.status === "creator" || m.status === "administrator" || m.status === "member") return true;
    return m.status === "restricted" && m.is_member === true;
  };

  try {
    const dedupe = await redis(["SET", "tg:update:" + updateId, "1", "EX", "2592000", "NX"]);
    if (dedupe !== "OK") return res.status(200).json({ ok: true, duplicate: true });

    const day = new Date().toISOString().slice(0, 10);
    const prefix = "tg:daily:" + day + ":";
    let kind = null;
    let user = null;
    let chat = null;

    if (update.chat_join_request) {
      const x = update.chat_join_request;
      chat = x.chat;
      user = x.from;
      if (String(chat.id) === String(channelId)) kind = "join_requests";
    } else if (update.chat_member) {
      const x = update.chat_member;
      chat = x.chat;
      user = x.new_chat_member && x.new_chat_member.user;
      if (String(chat.id) === String(channelId)) {
        const wasMember = memberStatus(x.old_chat_member);
        const isMember = memberStatus(x.new_chat_member);
        if (!wasMember && isMember) kind = "accepted_joins";
        else if (wasMember && !isMember) kind = "leaves";
      }
    }

    if (kind) {
      await redis(["INCR", prefix + kind]);
      await redis(["EXPIRE", prefix + kind, "7776000"]);
      await redis(["INCR", "tg:total:" + kind]);
      const event = JSON.stringify({
        type: kind,
        date: day,
        user_id: user && user.id ? String(user.id) : null,
        username: user && user.username ? user.username : null,
        at: new Date().toISOString()
      });
      await redis(["LPUSH", "tg:recent_events", event]);
      await redis(["LTRIM", "tg:recent_events", "0", "99"]);
    }
    return res.status(200).json({ ok: true, tracked: Boolean(kind), type: kind });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Tracking storage temporarily unavailable" });
  }
};
