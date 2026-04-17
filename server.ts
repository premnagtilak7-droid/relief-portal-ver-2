import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

async function startServer() {
  const PORT = 3000;

  // Initialize Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL: GEMINI_API_KEY is missing from environment variables.");
  }
  const genAI = new GoogleGenerativeAI(apiKey || "");

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Gemini Triage endpoint
  app.post("/api/gemini/triage", async (req, res) => {
    try {
      const { emergencyType, description } = req.body;
      const prompt = `You are a disaster relief triage AI. Analyze the following emergency request and categorize it.

Emergency Type: ${emergencyType}
Description: ${description}

Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation):
{
  "category": "Medical" | "Food" | "Water" | "Shelter" | "Rescue" | "Other",
  "priority": 1-5 (1 = most urgent, 5 = least urgent),
  "reasoning": "brief explanation"
}

Priority Guidelines:
- 1: Life-threatening, immediate danger (severe injuries, trapped, drowning)
- 2: Urgent medical needs, vulnerable populations (elderly, children, disabled)
- 3: Basic needs critically low (no water for 24h+, no food for 48h+)
- 4: Important but stable (shelter damage, low supplies)
- 5: Non-urgent assistance (information requests, minor needs)`;

      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const result = await model.generateContent(prompt);
      
      const responseText = result.response.text();
      
      const jsonMatch = responseText?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Invalid AI response");
      
      res.json(JSON.parse(jsonMatch[0]));
    } catch (error) {
      console.error("Server Triage Error:", error);
      res.status(500).json({ error: "Failed to triage" });
    }
  });

  // Gemini Analyze Photo endpoint
  app.post("/api/gemini/analyze-photo", async (req, res) => {
    try {
      const { base64Data } = req.body;
      const prompt = `Quickly categorize this image. Reply ONLY with JSON:
{"isFalseAlarm":bool,"category":"Flood|Fire|Medical|Collapse|Irrelevant","severity":0-10,"description":"max 20 words"}

Rules:
- Food photos, menus, selfies = Irrelevant, severity 0, isFalseAlarm true
- Real disasters = appropriate category, severity 1-10 based on urgency`;

      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]);
      
      const responseText = result.response.text();
      const jsonMatch = responseText?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Invalid AI response");
      
      res.json(JSON.parse(jsonMatch[0]));
    } catch (error) {
      console.error("Server Analyze Photo Error:", error);
      res.status(500).json({ error: "Failed to analyze photo" });
    }
  });

  // Gemini Analyze ID endpoint
  app.post("/api/gemini/analyze-id", async (req, res) => {
    try {
      const { base64Data } = req.body;
      const prompt = `You are an identity verification AI. Analyze this document uploaded by a potential disaster relief volunteer.
    
    Tasks:
    1. Determine if this is a valid identity document (ID card, Passport, Driver's License, or specialized Certification).
    2. Extract the full name if visible.
    3. Provide a brief verification note.
    4. Guard against: random photos, non-ID documents, blurry/unreadable images.
    
    Respond ONLY with a valid JSON object:
    {
      "isValidDocument": boolean,
      "documentType": "Passport" | "ID Card" | "License" | "Certification" | "Invalid",
      "extractedName": "Name as shown",
      "verificationNotes": "Brief reasoning",
      "confidenceScore": 0-100
    }`;

      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ]);
      
      const responseText = result.response.text();
      const jsonMatch = responseText?.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Invalid AI response");
      
      res.json(JSON.parse(jsonMatch[0]));
    } catch (error) {
      console.error("Server Analyze ID Error:", error);
      res.status(500).json({ error: "Failed to verify identity" });
    }
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
