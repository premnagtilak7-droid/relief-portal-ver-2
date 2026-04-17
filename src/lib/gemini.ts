import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini on the client
// Handle process.env safely for browser environments
const getApiKey = () => {
  try {
    // Try process.env (Node/some polyfills)
    if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }
  } catch (e) {
    // Ignore error
  }
  
  // Fallback to Vite's import.meta.env
  return import.meta.env.VITE_GEMINI_API_KEY || "";
};

const ai = new GoogleGenAI({
  apiKey: getApiKey()
});

const DEFAULT_MODEL = "gemini-3-flash-preview";

export interface TriageResult {
  category: "Medical" | "Food" | "Water" | "Shelter" | "Rescue" | "Other";
  priority: 1 | 2 | 3 | 4 | 5;
  reasoning?: string;
}

export interface VisionAnalysis {
  severity: number; // 1-10
  primaryNeed: "Medical" | "Rescue" | "Food" | "Shelter" | "Water" | "Other";
  description: string;
  urgentDetails?: string;
  isFalseAlarm: boolean;
  falseAlarmReason?: string | null;
  targetStation?: string | null;
}

export interface VerificationAnalysis {
  isValidDocument: boolean;
  documentType: string;
  extractedName?: string;
  verificationNotes: string;
  confidenceScore: number; // 0-100
}

/**
 * Helper to extract JSON from AI response text
 */
function extractJSON(text: string): any {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("JSON Parse Error:", e);
    return null;
  }
}

/**
 * Triage an alert using client-side Gemini
 */
export async function triageAlert(
  emergencyType: string,
  description: string
): Promise<TriageResult> {
  try {
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

    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const result = extractJSON(response.text || "{}");
    if (!result) throw new Error("Could not parse triage result");
    
    return result;
  } catch (error) {
    console.error("Client Triage Error:", error);
    return {
      category: "Other",
      priority: 3,
      reasoning: "Auto-assigned due to triage system unavailability",
    };
  }
}

/**
 * Triage and update an alert document in Firestore
 */
export async function triageAndUpdateAlert(
  alertId: string,
  emergencyType: string,
  description: string
): Promise<TriageResult> {
  const triageResult = await triageAlert(emergencyType, description);
  
  try {
    const alertRef = doc(db, "alerts", alertId);
    await updateDoc(alertRef, {
      aiTriage: triageResult,
      triageCategory: triageResult.category,
      triagePriority: triageResult.priority,
    });
  } catch (error) {
    console.error("Failed to update alert with triage:", error);
  }
  
  return triageResult;
}

/**
 * Analyze an identity document for volunteer verification using client-side Gemini
 */
export async function analyzeIdentityDocument(base64Data: string): Promise<VerificationAnalysis> {
  try {
    const prompt = `Analyze this document for identity verification. 
    A volunteer is joining a disaster relief team. We need to verify they are a real person with a valid ID or professional cert.
  
  Tasks:
  1. Identify the document type.
  2. Is it a valid ID or professional certification (Medical license, Firefighter ID, etc.)?
  3. Extract the full name.
  4. If it's just a random photo, food, or totally unreadable, mark as invalid.
  
  Respond ONLY with JSON:
  {
    "isValidDocument": boolean,
    "documentType": "Passport" | "ID Card" | "License" | "Certification" | "Invalid",
    "extractedName": "Full Name",
    "verificationNotes": "Brief reason for your decision",
    "confidenceScore": 0-100
  }`;

    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [
        { text: prompt },
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const result = extractJSON(response.text || "{}");
    if (!result) throw new Error("Could not parse ID verification result");
    
    return result;
  } catch (error) {
    console.error("Client ID verification error:", error);
    return {
      isValidDocument: false,
      documentType: "Error",
      verificationNotes: "Analysis system encountered an error. Please try a clearer photo or check your connection.",
      confidenceScore: 0
    };
  }
}

/**
 * Analyze a base64 image directly using client-side Gemini
 */
export async function analyzeBase64Photo(base64Data: string): Promise<VisionAnalysis> {
  try {
    const prompt = `Quickly categorize this disaster-related image. 
    Strictness: Ignore selfies, food, and clearly irrelevant photos.
    Reply ONLY with JSON:
{
  "isFalseAlarm": bool,
  "category": "Flood|Fire|Medical|Collapse|Irrelevant",
  "severity": 1-10,
  "description": "max 20 words",
  "targetStation": "Fire Department|Medical Center|Coast Guard|Police Station|Relief Hub"
}

Rules for targetStation:
- Fire/Collapse/Entrapment -> "Fire Department"
- Injuries/Sickness -> "Medical Center"
- Floods/Water rescue -> "Coast Guard"
- Security/Civil unrest -> "Police Station"
- General damage/Irrelevant -> "Relief Hub"

Reply with JSON only.`;

    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [
        { text: prompt },
        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
      ],
      config: {
        responseMimeType: "application/json"
      }
    });

    const parsed = extractJSON(response.text || "{}");
    if (!parsed) throw new Error("Could not parse photo analysis result");

    const categoryToNeed: Record<string, string> = {
      'Flood': 'Rescue',
      'Fire': 'Rescue', 
      'Medical': 'Medical',
      'Collapse': 'Rescue',
      'Irrelevant': 'Other'
    };
    
    return {
      isFalseAlarm: parsed.isFalseAlarm || parsed.category === 'Irrelevant',
      falseAlarmReason: parsed.isFalseAlarm ? parsed.description : null,
      severity: parsed.isFalseAlarm ? 0 : (parsed.severity || 5),
      primaryNeed: (categoryToNeed[parsed.category] || 'Other') as VisionAnalysis['primaryNeed'],
      description: parsed.description || 'Analysis complete',
      targetStation: parsed.targetStation || 'Relief Hub'
    };
  } catch (error) {
    console.error("Client Base64 analysis error:", error);
    return {
      severity: 5,
      primaryNeed: "Other",
      description: "Unable to analyze photo at this time",
      isFalseAlarm: false,
      falseAlarmReason: null,
      targetStation: "Relief Hub"
    };
  }
}

/**
 * Analyze a disaster photo using client-side Gemini
 */
export async function analyzeDisasterPhoto(imageUrl: string): Promise<VisionAnalysis> {
  try {
    const fetchResponse = await fetch(imageUrl);
    const blob = await fetchResponse.blob();
    const base64Data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    });

    return await analyzeBase64Photo(base64Data);
  } catch (error) {
    console.error("Client Analyze Photo Error:", error);
    return {
      severity: 5,
      primaryNeed: "Other",
      description: "Unable to analyze photo automatically",
      isFalseAlarm: false,
      falseAlarmReason: null,
      targetStation: "Relief Hub"
    };
  }
}

/**
 * Analyze photo and update alert document
 */
export async function analyzeAndUpdateAlert(
  alertId: string,
  imageUrl: string
): Promise<VisionAnalysis> {
  const analysis = await analyzeDisasterPhoto(imageUrl);
  
  try {
    const alertRef = doc(db, "alerts", alertId);
    await updateDoc(alertRef, {
      visionAnalysis: analysis,
      aiSeverity: analysis.severity,
      aiPrimaryNeed: analysis.primaryNeed,
      targetStation: analysis.targetStation || "Relief Hub",
    });
  } catch (error) {
    console.error("Failed to update alert with vision analysis:", error);
  }
  
  return analysis;
}
