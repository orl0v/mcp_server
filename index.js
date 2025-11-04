import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Environment variable
const SHOPIFY_MCP_URL = process.env.SHOPIFY_MCP_URL;

// Basic health check
app.get("/", (req, res) => res.send("Shopify MCP proxy running"));

// Handles ElevenLabs JSON-RPC POST
app.post("/mcp", async (req, res) => {
  try {
    const response = await fetch(SHOPIFY_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    let data = await response.json();

    // Fix: parse JSON strings inside "text" blocks
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

    res.json(data);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Optionally support Server-Sent Events transport for ElevenLabs
app.get("/mcp/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  res.write(`event: open\ndata: connected\n\n`);
  // Keep alive
  const keepAlive = setInterval(() => res.write("event: ping\ndata: {}\n\n"), 15000);
  req.on("close", () => clearInterval(keepAlive));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proxy live on port ${port}`));
