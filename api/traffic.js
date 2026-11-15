// Vercel serverless endpoint: privacy-conscious click-quality signals.
// Requires UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN and TRAFFIC_HASH_SALT.
// Raw IP addresses and user-agent strings are never stored.
const { createHash } = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // Accept only same-origin browser submissions to this endpoint.
  const host = String(req.headers.host || "").toLowerCase();
  const origin = String(req.headers.origin || "");
  if (!host || !origin) return res.status(403).json({ ok: false, error: "Origin required" });
  try {
    if (new URL(origin).host.toLowerCase() !== host) {
      return res.status(403).json({ ok: false, error: "Cross-origin request blocked" });
    }
  } catch (_) {
    return res.status(403).json({ ok: false, error: "Invalid origin" });
  }

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const salt = process.env.TRAFFIC_HASH_SALT;
  if (!redisUrl || !redisToken || !salt) {
    return res.status(503).json({ ok: false, error: "Traffic monitor is not configured" });
  }

  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || String(req.socket?.remoteAddress || "unknown");
  const userAgent = String(req.headers["user-agent"] || "").slice(0, 300);
  const fingerprint = createHash("sha256")
    .update(ip + ":" + userAgent + ":" + salt)
    .digest("hex")
    .slice(0, 32);
  const day = new Date().toISOString().slice(0, 10);
  const dailyKey = "scbc:daily:" + day + ":";

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const webdriver = payload.webdriver === true;

    // Run dedupe, counter increment and expiry in one Upstash pipeline request.
    const commands = [
      ["SET", "scbc:click:" + fingerprint, "1", "EX", "3", "NX"],
      ["INCR", dailyKey + (webdriver ? "suspicious" : "observed")],
      ["EXPIRE", dailyKey + (webdriver ? "suspicious" : "observed"), "7776000"]
    ];
    const response = await fetch(redisUrl.replace(/\/$/, "") + "/pipeline", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + redisToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands)
    });
    if (!response.ok) throw new Error("Redis pipeline request failed");

    const results = await response.json();
    if (!Array.isArray(results) || results.length !== commands.length ||
        results.some((item) => !item || item.error)) {
      throw new Error("Redis pipeline command failed");
    }

    const duplicate = results[0].result !== "OK";
    const bucket = (webdriver || duplicate) ? "suspicious" : "observed";

    // If the click was a duplicate but webdriver was false, move the count
    // from observed to suspicious using one additional pipeline request.
    if (duplicate && !webdriver) {
      const adjustment = await fetch(redisUrl.replace(/\/$/, "") + "/pipeline", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + redisToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([
          ["DECR", dailyKey + "observed"],
          ["INCR", dailyKey + "suspicious"],
          ["EXPIRE", dailyKey + "suspicious", "7776000"]
        ])
      });
      if (!adjustment.ok) throw new Error("Redis adjustment failed");
      const adjusted = await adjustment.json();
      if (!Array.isArray(adjusted) || adjusted.some((item) => !item || item.error)) {
        throw new Error("Redis adjustment command failed");
      }
    }

    return res.status(200).json({
      ok: true,
      classification: bucket,
      duplicate,
      signals: { webdriver, rapidRepeat: duplicate },
      note: "Diagnostic signals only. No visitor is blocked and no Meta conversion event is sent."
    });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Traffic monitor temporarily unavailable" });
  }
};
