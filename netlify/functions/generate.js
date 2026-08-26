// ============================================================
// POST /.netlify/functions/generate
// Body: { syllabus, depth, focus }
// Header: Authorization: Bearer <supabase access token>
//
// 1. Verifies the user via Supabase (using their access token)
// 2. Checks & deducts 1 credit (server-side, using the service key
//    so it can't be bypassed from the browser)
// 3. Calls Groq's free API (OpenAI-compatible) to extract topics.
//    If Groq is rate-limited (429) or errors out, automatically
//    falls back to Google Gemini's free tier so a traffic spike
//    on one provider doesn't take the whole app down.
// ============================================================
const { createClient } = require("@supabase/supabase-js");

// The project URL is public (the browser uses it too). Keeping this fallback
// prevents a mis-scoped Netlify variable from crashing the function.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://tawxmpsrxttwrsfjbklo.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
// Llama 3.3 70B was retired from Groq's free/developer tiers in August 2026.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // optional but recommended fallback
// Gemini 2.0 Flash has been retired. Keep this default aligned with the
// currently available Flash model; an explicit Netlify GEMINI_MODEL value
// still takes precedence.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 15_000);
  }
  // Short exponential backoff with jitter prevents a burst of students from
  // retrying the provider at exactly the same moment.
  return Math.min(750 * (2 ** attempt) + Math.floor(Math.random() * 300), 6_000);
}

async function fetchWithRetry(url, options, providerName) {
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status) || attempt === 2) {
        return response;
      }
      lastResponse = response;
      console.warn(`${providerName} returned ${response.status}; retrying.`);
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
      console.warn(`${providerName} request failed; retrying:`, error.message);
    }

    await sleep(retryDelayMs(lastResponse, attempt));
  }

  if (lastError) throw lastError;
  return lastResponse;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server configuration missing: SUPABASE_SERVICE_ROLE_KEY." }) };
  }
  if (!GROQ_API_KEY && !GEMINI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server configuration missing: add GROQ_API_KEY or GEMINI_API_KEY." }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token." }) };
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify the user's token
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid session. Please sign in again." }) };
    }
    const userId = userData.user.id;

    // Check credits
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return { statusCode: 400, body: JSON.stringify({ error: "No profile found. Contact support." }) };
    }
    if (profile.credits < 1) {
      return { statusCode: 402, body: JSON.stringify({ error: "Out of credits. Buy more to continue." }) };
    }

    const { syllabus, depth, focus } = JSON.parse(event.body || "{}");
    if (!syllabus || syllabus.trim().length < 20) {
      return { statusCode: 400, body: JSON.stringify({ error: "Syllabus text is too short." }) };
    }

    const pointsPerTopic = ["3", "5", "10"].includes(String(depth)) ? String(depth) : "5";
    const focusInstruction = {
      balanced: "a mix of definitions, key facts, and examples",
      definitions: "primarily precise definitions of key terms",
      formulas: "primarily formulas and key equations (include definitions only for terms in the formula)",
      examples: "primarily short worked examples or applications"
    }[focus] || "a mix of definitions, key facts, and examples";

    const systemPrompt = `You are Brahmastra, an exam cheatsheet generator. Given a raw syllabus, extract the distinct topics and produce exam-ready revision points for each.

Rules:
- Return ONLY valid JSON, no markdown fences, no commentary.
- JSON shape: {"topics":[{"title":"string","points":["string", ...]}]}
- Each topic must have exactly ${pointsPerTopic} points.
- Points should be short (under 20 words), dense, and revision-friendly.
- Focus on ${focusInstruction}.
- Detect topics automatically even if the syllabus is messy or unformatted.
- Do not invent topics that aren't implied by the syllabus text.`;

    const userContent = syllabus.slice(0, 12000);
    let parsed = null;
    let usedProvider = null;

    // ---- Attempt 1: Groq (fast, free, but tightly rate-limited) ----
    if (GROQ_API_KEY) {
      try {
        const groqRes = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        })
        }, "Groq");

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          parsed = JSON.parse(groqData.choices[0].message.content);
          usedProvider = "groq";
        } else {
          console.warn("Groq unavailable (status " + groqRes.status + "), falling back to Gemini.");
        }
      } catch (e) {
        console.warn("Groq call failed, falling back to Gemini:", e.message);
      }
    }

    // ---- Attempt 2: Gemini fallback (only if Groq failed/rate-limited) ----
    if (!parsed && GEMINI_API_KEY) {
      try {
        const geminiRes = await fetchWithRetry(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: userContent }] }],
              systemInstruction: { parts: [{ text: systemPrompt }] },
              generationConfig: {
                temperature: 0.3,
                responseMimeType: "application/json"
              }
            })
          },
          "Gemini"
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const textOut = geminiData.candidates[0].content.parts[0].text;
          parsed = JSON.parse(textOut);
          usedProvider = "gemini";
        } else {
          const errText = await geminiRes.text();
          console.error("Gemini fallback also failed:", errText);
        }
      } catch (e) {
        console.error("Gemini fallback threw:", e.message);
      }
    }

    // ---- Both providers failed ----
    if (!parsed) {
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: "We're experiencing heavy traffic right now. Please try again in a minute — your credit was not charged.",
          retryable: true
        })
      };
    }

    if (!parsed.topics || !Array.isArray(parsed.topics) || parsed.topics.length === 0) {
      return { statusCode: 502, body: JSON.stringify({ error: "No topics detected. Try pasting more detail." }) };
    }

    // Deduct 1 credit now that generation succeeded
    await supabaseAdmin
      .from("profiles")
      .update({ credits: profile.credits - 1 })
      .eq("id", userId);

    return {
      statusCode: 200,
      body: JSON.stringify({ topics: parsed.topics, provider: usedProvider })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error. Please try again." }) };
  }
};
