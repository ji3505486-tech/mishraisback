// Vercel serverless endpoint: privacy-conscious click-quality signals.
// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
// Raw IP addresses are never stored; only a salted SHA-256 digest is used for a short rate-limit key.
const { createHash } = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const salt = process.env.TRAFFIC_HASH_SALT;
  if (!redisUrl || !redisToken || !salt) {
    return res.status(503).json({ ok: false, error: "Traffic monitor is not configured" });
  }

  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || String(req.socket?.remoteAddress || "unknown");
  const digest = createHash("sha256").update(ip + ":" + salt).digest("hex").slice(0, 32);
  const day = new Date().toISOString().slice(0, 10);
  const redis = async (command) => {
    const response = await fetch(redisUrl.replace(/\/$/, "") + "/" + command.map(encodeURIComponent).join("/"), {
      headers: { Authorization: "Bearer " + redisToken }
    });
    if (!response.ok) throw new Error("Redis request failed");
    return response.json();
  };

  try {
    const dedupe = await redis(["SET", "scbc:click:" + digest, "1", "EX", "8", "NX"]);
    const duplicate = dedupe.result !== "OK";
    const suspicious = Boolean(req.body && req.body.webdriver === true) || duplicate;

    await redis(["INCR", "scbc:daily:" + day + ":" + (suspicious ? "suspicious" : "observed")]);
    await redis(["EXPIRE", "scbc:daily:" + day + ":" + (suspicious ? "suspicious" : "observed"), "7776000"]);

    return res.status(200).json({ ok: true, classification: suspicious ? "suspicious" : "observed", duplicate, note: "Signals only; no Meta event is sent and no genuine visitor is blocked." });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Traffic monitor temporarily unavailable" });
  }
};
