// index.js
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import cors from "cors";
import http from "http";
import https from "https";

// Ensure HTTP/1.1 keep-alive (some MCP clients break on HTTP/2)
http.globalAgent.keepAlive = true;
https.globalAgent.keepAlive = true;
https.globalAgent.maxSockets = 10;

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Environment variable: your Shopify store’s MCP endpoint
const SHOPIFY_MCP_URL = process.env.SHOPIFY_MCP_URL;
if (!SHOPIFY_MCP_URL) {
  console.error("❌ Missing SHOPIFY_MCP_URL environment variable.");
  process.exit(1);
}

// --- Health check ---
app.get("/", (req, res) => {
  res.status(200).send("Shopify MCP proxy running");
});

// --- SSE (Server-Sent Events) handshake for ElevenLabs ---
app.get("/mcp/sse", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Immediately confirm connection so ElevenLabs doesn't time out
  res.write(`event: open\ndata: connected\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write("event: ping\ndata: {}\n\n");
  }, 10000);

  req.on("close", () => clearInterval(keepAlive));
});

// --- Main MCP endpoint (JSON-RPC bridge) ---
app.post("/mcp", async (req, res) => {
  try {
    const payload = req.body;

    // Inject default context for search_shop_catalog if missing
    if (
      payload?.method === "tools/call" &&
      payload?.params?.name === "search_shop_catalog"
    ) {
      if (!payload.params.arguments.context) {
        payload.params.arguments.context = "default";
      }
    }

    const upstreamResponse = await fetch(SHOPIFY_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await upstreamResponse.json();

    // Try to parse text blocks containing JSON
    if (data?.result?.content) {
      data.result.content = data.result.content.map((block) => {
        if (block.type === "text") {
          try {
            const parsed = JSON.parse(block.text);
            return { type: "json", json: parsed };
          } catch {
            return block;
          }
        }
        return block;
      });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("❌ Error in /mcp:", err);
    res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id || 0,
      error: {
        code: -32000,
        message: "Proxy Error",
        data: err.message,
      },
    });
  }
});

// --- Fallback route ---
app.use((req, res) => {
  res.status(404).send("Not found");
});

// --- Start server ---
const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () =>
  console.log(`✅ Shopify MCP proxy running on port ${port}`)
);
