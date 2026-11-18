// Create a visitor-specific Telegram join-request link after explicit optional-tracking consent.
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const body = req.body || {};
  if (typeof body.consent !== 'boolean') return res.status(400).json({ ok: false, error: "Consent choice required" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!token || !channelId || !redisUrl || !redisToken) {
    return res.status(503).json({ ok: false, error: "Invite service is not configured" });
  }

  const cleanCookie = (value, prefix) => {
    const s = typeof value === "string" ? value.slice(0, 500) : "";
    return s.startsWith(prefix) && /^[A-Za-z0-9._-]+$/.test(s) ? s : "";
  };
  const consent = body.consent === true;
  const fbp = consent ? cleanCookie(body.fbp, "fb.") : "";
  const fbc = consent ? cleanCookie(body.fbc, "fb.") : "";
  const clientUserAgent = consent ? String(req.headers["user-agent"] || "").slice(0, 1000) : "";
  const attribution = { fbp, fbc, client_user_agent: clientUserAgent, consent, created_at: Date.now() };
  const inviteName = "web-" + crypto.randomBytes(6).toString("hex");

  async function redis(parts) {
    const r = await fetch(redisUrl.replace(/\/$/, "") + "/" + parts.map(encodeURIComponent).join("/"), {
      headers: { Authorization: "Bearer " + redisToken }
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error("Redis unavailable");
    return j.result;
  }

  try {
    const tg = await fetch("https://api.telegram.org/bot" + token + "/createChatInviteLink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channelId,
        name: inviteName,
        creates_join_request: true,
        expire_date: Math.floor(Date.now() / 1000) + 604800
      })
    });
    const result = await tg.json();
    if (!tg.ok || !result.ok || !result.result || !result.result.invite_link) {
      return res.status(502).json({ ok: false, error: "Telegram could not create a visitor invite" });
    }

    const inviteLink = result.result.invite_link;
    const key = "tg:v2:invite:" + crypto.createHash("sha256").update(inviteLink).digest("hex");
    await redis(["SET", key, JSON.stringify(attribution), "EX", "2592000"]);
    return res.status(200).json({ ok: true, invite_link: inviteLink, expires_in: 604800 });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Could not prepare a visitor invite" });
  }
};
