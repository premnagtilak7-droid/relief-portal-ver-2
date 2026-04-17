import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

let twilioClient: any = null;

const getTwilioClient = async () => {
  if (!twilioClient) {
    const { default: twilio } = await import('twilio');
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      throw new Error('Twilio credentials missing');
    }
    twilioClient = twilio(sid, token);
  }
  return twilioClient;
};

app.post("/api/emergency/sos-broadcast", async (req, res) => {
  const { recipientNumber, message, type } = req.body;
  
  if (!recipientNumber || !message) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const client = await getTwilioClient();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!fromNumber) {
      throw new Error('TWILIO_PHONE_NUMBER missing');
    }

    // 1. Send SMS
    const sms = await client.messages.create({
      body: message,
      from: fromNumber,
      to: recipientNumber
    });

    // 2. Initiate Call with TwiML
    const call = await client.calls.create({
      twiml: `<Response><Say voice="alice">Emergency alert from Relief Portal. Type: ${type || 'General'}. Check your messages for details.</Say><Pause length="1"/><Say>Repeating. Emergency alert from Relief Portal. Check your messages.</Say></Response>`,
      from: fromNumber,
      to: recipientNumber
    });

    res.json({ 
      success: true, 
      smsSid: sms.sid, 
      callSid: call.sid 
    });
  } catch (error: any) {
    console.error('Twilio Error:', error);
    res.status(500).json({ 
      error: 'Failed to broadcast SOS via Twilio', 
      details: error.message 
    });
  }
});

if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Development mode: Attach Vite middleware (only if NOT on Vercel or explicitly in dev)
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  (async () => {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  })();
}

export default app;
