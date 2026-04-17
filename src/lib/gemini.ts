import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

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
  falseAlarmReason?: string;
}

export interface VerificationAnalysis {
  isValidDocument: boolean;
  documentType: string;
  extractedName?: string;
  verificationNotes: string;
  confidenceScore: number; // 0-100
}

/**
 * Triage an alert using backend Gemini proxy
 */
export async function triageAlert(
  emergencyType: string,
  description: string
): Promise<TriageResult> {
  try {
    const response = await fetch("/api/gemini/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emergencyType, description }),
    });

    if (!response.ok) throw new Error("Triage request failed");
    return await response.json();
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
 * Analyze a disaster photo using backend Gemini proxy
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
    };
  }
}

/**
 * Analyze an identity document for volunteer verification
 */
export async function analyzeIdentityDocument(base64Data: string): Promise<VerificationAnalysis> {
  try {
    const response = await fetch("/api/gemini/analyze-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Data }),
    });

    if (!response.ok) throw new Error("ID verification request failed");
    return await response.json();
  } catch (error) {
    console.error("Client ID verification error:", error);
    return {
      isValidDocument: false,
      documentType: "Error",
      verificationNotes: "Analysis failed. Please ensure the photo is clear.",
      confidenceScore: 0
    };
  }
}

/**
 * Analyze a base64 image directly
 */
export async function analyzeBase64Photo(base64Data: string): Promise<VisionAnalysis> {
  try {
    const response = await fetch("/api/gemini/analyze-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Data }),
    });

    if (!response.ok) throw new Error("Photo analysis request failed");
    const parsed = await response.json();

    // Map category to primaryNeed (matching server-side logic if needed, but here we assume server returns mapped values or we map them)
    const categoryToNeed: Record<string, string> = {
      'Flood': 'Rescue',
      'Fire': 'Rescue', 
      'Medical': 'Medical',
      'Collapse': 'Rescue',
      'Irrelevant': 'Other'
    };
    
    return {
      isFalseAlarm: parsed.isFalseAlarm || parsed.category === 'Irrelevant',
      falseAlarmReason: parsed.isFalseAlarm ? parsed.description : undefined,
      severity: parsed.isFalseAlarm ? 0 : (parsed.severity || 5),
      primaryNeed: (categoryToNeed[parsed.category] || 'Other') as VisionAnalysis['primaryNeed'],
      description: parsed.description || 'Analysis complete',
    };
  } catch (error) {
    console.error("Client Base64 analysis error:", error);
    return {
      severity: 5,
      primaryNeed: "Other",
      description: "Unable to analyze photo",
      isFalseAlarm: false,
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
    });
  } catch (error) {
    console.error("Failed to update alert with vision analysis:", error);
  }
  
  return analysis;
}
