const { handler } = require("../netlify/functions/create-order");
const { adapt } = require("./_netlify-adapter");

module.exports = (req, res) => adapt(handler, req, res);
