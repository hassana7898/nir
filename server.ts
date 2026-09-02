import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { installAutomaticBackup } from "./automaticBackup.cjs";
import { installAuth, requireAuth } from "./serverAuth.cjs";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "50mb";

// NIR is normally same-origin. Cross-origin API access is opt-in and credentialed only.
const allowedOrigin = process.env.CORS_ORIGIN;
if (allowedOrigin) {
  app.use(cors({
    origin: allowedOrigin.split(",").map((origin) => origin.trim()).filter(Boolean),
    credentials: true,
  }));
}
app.use(express.json({ limit: JSON_BODY_LIMIT }));

installAuth(app);
app.use("/api/backup", requireAuth);
installAutomaticBackup(app);
app.use("/api/extract", requireAuth);

let ai: GoogleGenAI | null = null;
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (apiKey) { try { ai = new GoogleGenAI({ apiKey }); } catch (err) { console.warn("Could not initialize GoogleGenAI:", err); } }

app.get("/api/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
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
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: {
        sellerName: { type: Type.STRING, nullable: true }, productName: { type: Type.STRING, nullable: true }, billWeight: { type: Type.NUMBER, nullable: true }, scaleWeight: { type: Type.NUMBER, nullable: true }, driverName: { type: Type.STRING, nullable: true }, billNumber: { type: Type.STRING, nullable: true }, origin: { type: Type.STRING, nullable: true }, transportCost: { type: Type.NUMBER, nullable: true }, driverPhone: { type: Type.STRING, nullable: true }, driverIBAN: { type: Type.STRING, nullable: true }
      }}
    } : {
      type: Type.ARRAY,
      items: { type: Type.OBJECT, properties: {
        farmerName: { type: Type.STRING, nullable: true }, productName: { type: Type.STRING, nullable: true }, weight: { type: Type.NUMBER, nullable: true }, driverName: { type: Type.STRING, nullable: true }, invoiceNumber: { type: Type.STRING, nullable: true }
      }}
    };
    const kf = knownFarmers?.length ? `\nKnown Farmers/Sellers: ${knownFarmers.join(", ")}` : "";
    const kp = knownProducts?.length ? `\nKnown Products: ${knownProducts.join(", ")}` : "";
    const kd = knownDrivers?.length ? `\nKnown Drivers: ${knownDrivers.join(", ")}` : "";
    const contextStr = `${kf}${kp}${kd}`;
    const promptText = type === "entry"
      ? `Task: Extract Persian raw materials entry remittance data from this image/pdf (Right-to-Left). Return a JSON Array of objects. Columns mapped to JSON keys: Seller Name (فروشنده) -> sellerName; Product (نوع محصول) -> productName; Bill Weight (وزن بارنامه) -> billWeight; Scale Weight (وزن باسکول) -> scaleWeight; Driver (راننده) -> driverName; Bill Number (شماره بارنامه/حواله) -> billNumber; Origin (مبدا) -> origin; Transport Cost (کرایه) -> transportCost; Driver Phone -> driverPhone; Driver IBAN -> driverIBAN. CRITICAL: Always separate seller name from product name. Commodity words such as ذرت، سویا، دان، گندم، جو، کنجاله، روغن، مکمل، سبوس، پلت، کربنات، نمک، متیونین، لیزین belong in productName, not sellerName. Context:${contextStr}`
      : `Task: Extract Persian exit remittance data from this image/pdf (Right-to-Left). Return a JSON Array of objects. Columns mapped to JSON keys: Farmer Name (مرغدار/خریدار) -> farmerName; Product -> productName; Weight -> weight; Driver -> driverName; Invoice No -> invoiceNumber. CRITICAL: Always separate farmer name from product name. Agricultural commodity words belong in productName, not farmerName. Context:${contextStr}`;
    const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: { parts: [{ inlineData: { mimeType, data: base64Data } }, { text: promptText }] }, config: { responseMimeType: "application/json", responseSchema } });
    if (!response.text) return res.status(502).json({ error: "Empty response from Gemini." });
    let rawData = JSON.parse(response.text.trim());
    if (Array.isArray(rawData)) {
      const productKeywords = ["ذرت", "سویا", "پیش دان", "میان دان", "پس دان", "دان", "گندم", "جو", "مرغ", "کنجاله", "پودر", "روغن", "مکمل", "سبوس", "رول", "پلت", "کراش", "پریمال", "متیونین", "لیزین", "کربنات", "صدف", "نمک", "جوجه", "گوشتی", "زنده", "استارتر", "ویتامین", "کلسیم", "فسفر", "دی کلسیم", "کنسانتره", "رشد", "آغازین", "پایانی"];
      const kpArray = (knownProducts || []).map((p: string) => p.trim());
      const allProducts = [...new Set([...productKeywords, ...kpArray])].sort((a, b) => b.length - a.length);
      rawData = rawData.map((item: any) => {
        let nameObj = type === "entry" ? item.sellerName : item.farmerName;
        const prodObj = item.productName;
        if (nameObj && typeof nameObj === "string" && (!prodObj || prodObj.toString().trim() === "")) {
          let name = nameObj.trim(); let productNameRaw = "";
          for (const p of allProducts) {
            if (p && name.includes(p)) {
              const regex = new RegExp(`(?:^|\\s)(${p})(?:\\s|$)`); const match = name.match(regex);
              if (match) { productNameRaw = match[1]; name = name.replace(regex, " ").trim(); break; }
              if (name.endsWith(p)) { productNameRaw = p; name = name.slice(0, name.length - p.length).trim(); break; }
            }
          }
          if (productNameRaw) { if (type === "entry") item.sellerName = name; else item.farmerName = name; item.productName = productNameRaw; }
        }
        return item;
      });
    }
    return res.json(rawData);
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
