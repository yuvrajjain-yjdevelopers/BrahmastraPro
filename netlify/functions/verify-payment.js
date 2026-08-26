// ============================================================
// POST /.netlify/functions/verify-payment
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, credits }
// Header: Authorization: Bearer <supabase access token>
// ============================================================
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tawxmpsrxttwrsfjbklo.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!SUPABASE_SERVICE_KEY || !process.env.RAZORPAY_KEY_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: "Payment service is not configured yet." }) };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token." }) };
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid session." }) };
    }
    const userId = userData.user.id;

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, credits } = JSON.parse(event.body || "{}");
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !credits) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing payment fields." }) };
    }

    // Verify signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return { statusCode: 400, body: JSON.stringify({ error: "Payment verification failed." }) };
    }

    // Signature valid — top up credits
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return { statusCode: 400, body: JSON.stringify({ error: "No profile found." }) };
    }

    await supabaseAdmin
      .from("profiles")
      .update({ credits: profile.credits + Number(credits) })
      .eq("id", userId);

    return { statusCode: 200, body: JSON.stringify({ success: true, newCredits: profile.credits + Number(credits) }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error verifying payment." }) };
  }
};
