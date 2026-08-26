const { handler } = require("../netlify/functions/verify-payment");
const { adapt } = require("./_netlify-adapter");

module.exports = (req, res) => adapt(handler, req, res);
