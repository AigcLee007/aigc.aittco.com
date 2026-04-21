const { isMySqlConfigured } = require("./db.cjs");

module.exports = isMySqlConfigured()
  ? require("./billingStore.mysql.cjs")
  : require("./billingStore.file.cjs");
