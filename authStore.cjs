const { isMySqlConfigured } = require("./db.cjs");

module.exports = isMySqlConfigured()
  ? require("./authStore.mysql.cjs")
  : require("./authStore.file.cjs");
