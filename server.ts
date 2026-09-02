import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "50mb";

const allowedOrigin = process.env.CORS_ORIGIN;
app.use(
  cors(
    allowedOrigin
      ? { origin: allowedOrigin.split(",").map((origin) => origin.trim()).filter(Boolean) }
      : undefined,
  ),
);
app.use(express.json({ limit: JSON_BODY_LIMIT }));

let ai: GoogleGenAI | null = null;
const apiKey = process.env.GEMINI_API_KEY?.trim();

if (apiKey) {
  try { ai = new GoogleGenAI({ apiKey }); } catch (err) { console.warn("Could not initialize GoogleGenAI:", err); }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", environment: NODE_ENV, geminiConfigured: Boolean(process.env.GEMINI_API_KEY), model: GEMINI_MODEL });
});

app.post("/api/extract", async (req, res) => {
  try {
    const { base64Data, mimeType, type, knownFarmers, knownProducts, knownDrivers } = req.body;
    if (!base64Data || !mimeType || !type) return res.status(400).json({ error: "base64Data, mimeType and type are required." });
    if (!ai) {
      const runtimeKey = process.env.GEMINI_API_KEY?.trim();
      if (runtimeKey) ai = new GoogleGenAI({ apiKey: runtimeKey });
      else return res.status(503).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }
    const responseSchema = type === "entry" ? {
      type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
        sellerName: { type: Type.STRING, nullable: true }, productName: { type: Type.STRING, nullable: true }, billWeight: { type: Type.NUMBER, nullable: true }, scaleWeight: { type: Type.NUMBER, nullable: true }, driverName: { type: Type.STRING, nullable: true }, billNumber: { type: Type.STRING, nullable: true }, origin: { type: Type.STRING, nullable: true }, transportCost: { type: Type.NUMBER, nullable: true }, driverPhone: { type: Type.STRING, nullable: true }, driverIBAN: { type: Type.STRING, nullable: true },
      }}
    } : {
      type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
        farmerName: { type: Type.STRING, nullable: true }, productName: { type: Type.STRING, nullable: true }, weight: { type: Type.NUMBER, nullable: true }, driverName: { type: Type.STRING, nullable: true }, invoiceNumber: { type: Type.STRING, nullable: true },
      }}
    };
    const kf = knownFarmers?.length ? `\nKnown Farmers/Sellers: ${knownFarmers.join(", ")}` : "";
    const kp = knownProducts?.length ? `\nKnown Products: ${knownProducts.join(", ")}` : "";
    const kd = knownDrivers?.length ? `\nKnown Drivers: ${knownDrivers.join(", ")}` : "";
    const contextStr = `${kf}${kp}${kd}`;
    const promptText = type === "entry"
      ? `Task: Extract Persian raw materials entry remittance data from this image/pdf (Right-to-Left). Return a JSON Array of objects. Columns: Seller -> sellerName, Product -> productName, Bill Weight -> billWeight, Scale Weight -> scaleWeight, Driver -> driverName, Bill Number -> billNumber, Origin -> origin, Transport Cost -> transportCost, Driver Phone -> driverPhone, Driver IBAN -> driverIBAN. Separate seller and product. Known values:${contextStr}`
      : `Task: Extract Persian exit remittance data from this image/pdf (Right-to-Left). Return a JSON Array of objects. Columns: Farmer -> farmerName, Product -> productName, Weight -> weight, Driver -> driverName, Invoice No -> invoiceNumber. Separate farmer and product. Known values:${contextStr}`;
    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: promptText }] }, config: { responseMimeType: "application/json", responseSchema } });
    if (!response.text) return res.status(502).json({ error: "Empty response from Gemini." });
    return res.json(JSON.parse(response.text.trim()));
  } catch (error: any) {
    console.error("Gemini Extraction Error:", error);
    return res.status(error?.status === 429 ? 429 : 500).json({ error: error?.message || "Unknown error during AI extraction." });
  }
});

async function startServer() {
  if (NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist", "client");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT} (${NODE_ENV})`));
}
startServer().catch((error) => { console.error("Failed to start server:", error); process.exit(1); });
