// Lets the existing, security-reviewed Netlify handlers run unchanged as
// Vercel Serverless Functions. It translates Vercel's req/res interface into
// the small event/response shape used by the handlers.
async function adapt(handler, req, res) {
  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body: typeof req.body === "string" ? req.body : JSON.stringify(req.body || {})
  };

  const response = await handler(event);
  for (const [name, value] of Object.entries(response.headers || {})) {
    res.setHeader(name, value);
  }
  return res.status(response.statusCode || 200).send(response.body || "");
}

module.exports = { adapt };
