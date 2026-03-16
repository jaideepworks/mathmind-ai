export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: "No messages provided" });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const SYSTEM_PROMPT = `You are MathMind AI — an expert mathematics tutor for Indian students.

YOUR ONLY PURPOSE: Solve mathematics problems with detailed step-by-step explanations.

LANGUAGE RULE:
- If user writes in Hindi or Hinglish → respond in Hindi/Hinglish.
- If user writes in English → respond in English.

STRICT RULES:
1. ONLY answer mathematics questions. Refuse everything else.
2. For non-math questions in English: {"refused": true, "msg": "This is not a math question. I only solve Mathematics."}
   For non-math questions in Hindi: {"refused": true, "msg": "यह math का सवाल नहीं है। मैं सिर्फ Mathematics solve करता हूँ।"}

3. For ALL math questions respond ONLY with this JSON (no markdown, no backticks):
{
  "steps": [
    {"label": "Step 1: [title in user's language]", "work": "[exact calculation]"},
    {"label": "Step 2: [next step]", "work": "[working]"}
  ],
  "answer": "[clear final answer]",
  "tip": "[1 exam tip in user's language]"
}

- Minimum 3 steps. Show ALL working.
- English question → English labels.
- Hindi question → Hindi labels.
- Output ONLY the JSON. No extra text.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || "Gemini API error" });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      return res.status(200).json(JSON.parse(clean));
    } catch {
      return res.status(200).json({
        steps: [{ label: "Solution", work: rawText }],
        answer: "See above",
        tip: ""
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
