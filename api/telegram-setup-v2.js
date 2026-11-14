// One-time setup for the fresh v2 Telegram webhook.
// POST with Authorization: Bearer <TELEGRAM_SETUP_KEY_V2>.
// It replaces the bot's previous webhook URL with the v2 endpoint.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const expected = process.env.TELEGRAM_SETUP_KEY_V2;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET_V2;
  if (!token || !secret) return res.status(503).json({ ok: false, error: "New v2 Telegram settings are missing" });

  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://candy-is-live-1.vercel.app/api/telegram-webhook-v2",
        secret_token: secret,
        allowed_updates: ["chat_member", "chat_join_request"],
        drop_pending_updates: false
      })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) return res.status(502).json({ ok: false, error: "Telegram rejected the new webhook setup" });
    return res.status(200).json({ ok: true, webhook_version: "v2", webhook_configured: true });
  } catch (_) {
    return res.status(502).json({ ok: false, error: "Could not contact Telegram" });
  }
};
