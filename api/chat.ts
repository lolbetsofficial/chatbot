// api/chat.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED_ORIGINS = [
  "https://lol-bets.design.webflow.io", // Webflow Preview
  "https://lol-bets.design.webflow.com", // Webflow Designer/Preview
  "https://www.lol-bets.com"            // Live-Domain (später anpassen/ergänzen)
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ---- CORS ----
  const origin = req.headers.origin || "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, system, temperature = 0.3, max_tokens = 500 } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Missing messages[]" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY env" });
    }

    // Kontext begrenzen
    const safeMessages = messages.slice(-20);

    // OpenAI Stream
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        temperature,
        max_tokens,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          ...safeMessages
        ]
      })
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return res.status(500).json({ error: "OpenAI upstream error", detail });
    }

    // Stream 1:1 weiterreichen (SSE)
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader();
    let sent = 0;
    const LIMIT = 250_000; // ~250 KB

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sent += value?.length || 0;
      if (sent > LIMIT) break;
      res.write(value);
    }
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
