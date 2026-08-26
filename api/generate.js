const { handler } = require("../netlify/functions/generate");
const { adapt } = require("./_netlify-adapter");

module.exports = (req, res) => adapt(handler, req, res);
