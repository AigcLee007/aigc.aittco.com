const { isMySqlConfigured } = require("./db.cjs");

module.exports = isMySqlConfigured()
  ? require("./generationRecordStore.mysql.cjs")
  : require("./generationRecordStore.file.cjs");
