// ============================================================
// BRAHMASTRA — pricing page payment flow (Razorpay Checkout)
// ============================================================
document.querySelectorAll(".buy-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const card = btn.closest(".price-card");
    const credits = card.dataset.credits;
    const amount = card.dataset.amount; // paise

    const { data: sessionData } = await supabaseClient.auth.getSession();
    if (!sessionData.session) {
      alert("Please sign in on the dashboard first, then come back to buy credits.");
      window.location.href = "dashboard.html";
      return;
    }
    const token = sessionData.session.access_token;

    btn.disabled = true;
    btn.textContent = "Loading...";

    try {
      const orderRes = await fetch("/.netlify/functions/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ amount: Number(amount), credits: Number(credits) })
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.error || "Could not start payment.");

      const rzp = new Razorpay({
        key: order.key,
        amount: order.amount,
        currency: "INR",
        name: "Brahmastra",
        description: `${credits} credit${credits > 1 ? "s" : ""}`,
        order_id: order.orderId,
        handler: async function (response) {
          const verifyRes = await fetch("/.netlify/functions/verify-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              credits: Number(credits)
            })
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok) {
            alert(`Success! ${credits} credits added.`);
            window.location.href = "dashboard.html";
          } else {
            alert("Payment succeeded but verification failed: " + verifyData.error);
          }
        },
        theme: { color: "#FF7A28" }
      });
      rzp.open();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Buy";
    }
  });
});
