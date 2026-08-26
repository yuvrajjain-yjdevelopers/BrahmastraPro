// ============================================================
// POST /.netlify/functions/create-order
// Body: { amount, credits }   (amount in paise, e.g. ₹15 = 1500)
// Header: Authorization: Bearer <supabase access token>
// ============================================================
const { createClient } = require("@supabase/supabase-js");
const Razorpay = require("razorpay");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tawxmpsrxttwrsfjbklo.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!SUPABASE_SERVICE_KEY || !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
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

    const { amount, credits } = JSON.parse(event.body || "{}");
    if (!amount || !credits) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing amount or credits." }) };
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.create({
      amount, // in paise
      currency: "INR",
      notes: { user_id: userData.user.id, credits: String(credits) }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ orderId: order.id, amount: order.amount, key: process.env.RAZORPAY_KEY_ID })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not create order." }) };
  }
};
