const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");

const FAMILY_BY_NAME = new Map([
  ["Nano Banana Pro", "nano-banana-pro"],
  ["Nano banana 2.1", "gemini-nano-banana-2.1"],
  ["GPT-Image-2.5-Sunburst", "gpt-image-2.5-sunburst"],
  ["GPT-Image-2", "gpt-image-2"],
  ["Seedream-5-Pro", "seedream-5-pro"],
]);
const LINE_IDS = new Map([
  ["官方T3", "official-t3"], ["官方优质", "official-quality"],
  ["香蕉专线", "banana-dedicated"], ["特价线路", "discount"],
  ["备用线路", "backup"], ["备用线路V", "backup-v"],
  ["官转（支持高质量）", "official-relay-high-quality"],
  ["官key特价", "official-key-discount"], ["OA专线", "oa-dedicated"],
  ["原生4K", "native-4k"], ["官转特价", "official-relay-discount"],
  ["特价线路", "discount"], ["SD专线", "seedream-dedicated"],
]);
const QUALITY_NAMES = new Map([
  ["low", "low"], ["medium", "medium"], ["high", "high"],
  ["xhigh", "xhigh"], ["max", "max"],
]);
const trim = (value) => String(value ?? "").trim();
const pathFromCell = (value) => {
  const text = trim(value);
  if (!text || /^无/.test(text)) return "";
  if (text.startsWith("/")) return text;
  const url = new URL(text.startsWith("http") ? text : `https://${text}`);
  return `${url.pathname}${url.search}`;
};
const parts = (value) => trim(value).split("/").map(trim);
const costValue = (value) => value === "" ? null : Number(value);

const workbookPath = path.resolve(process.argv[2] || "C:/Users/Lee Aigc/Desktop/AIGC网页模型.xlsx");
const outputPath = path.resolve(process.argv[3] || path.join(__dirname, "../config/production-image-routes.json"));
const worksheet = XLSX.readFile(workbookPath).Sheets.Sheet1;
if (!worksheet) throw new Error("Workbook must contain Sheet1");
const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
if (rows.length !== 23) throw new Error(`Expected 23 routes, found ${rows.length}`);

const seen = new Set();
const routes = rows.map((row, index) => {
  const familyName = trim(row["模型大族"]) || trim(rows.slice(0, index + 1).reverse().find((entry) => trim(entry["模型大族"]))?.["模型大族"]);
  const modelFamily = FAMILY_BY_NAME.get(familyName);
  if (!modelFamily) throw new Error(`No existing route family mapping for: ${familyName}`);
  const line = trim(row["线路"]);
  const id = `${modelFamily}-${LINE_IDS.get(line) || `line-${index + 1}`}`;
  if (seen.has(id)) throw new Error(`Duplicate route ID: ${id}`);
  seen.add(id);

  const upstreamModels = parts(row["上游模型1K/2K/4K"]);
  const costs = parts(row["积分1K/2K/4K"]).map(costValue);
  const sizeKeys = ["1k", "2k", "4k"];
  const sizeOverrides = {};
  if (upstreamModels.length === 3 || costs.length === 3) {
    for (let sizeIndex = 0; sizeIndex < 3; sizeIndex += 1) {
      const override = {};
      if (upstreamModels.length === 3) override.upstreamModel = upstreamModels[sizeIndex];
      if (costs[sizeIndex] !== null && Number.isFinite(costs[sizeIndex])) override.pointCost = costs[sizeIndex];
      if (Object.keys(override).length) sizeOverrides[sizeKeys[sizeIndex]] = override;
    }
  }

  const generatePath = pathFromCell(row["生成接口"]);
  const queryAndEdit = trim(row["任务查询 / 编辑接口"]).split(/[；;]/).map(trim);
  const taskPath = queryAndEdit.find((value) => value.includes("{taskId}")) || "";
  const editPath = queryAndEdit.find((value) => /\/v\d+\/images\/edits/.test(value)) || "";
  const qualityText = trim(row["质量参数"]);
  const supportedQualities = qualityText === "/" ? undefined : [...new Set(
    [...qualityText.matchAll(/\b(low|medium|high|xhigh|max)\b/gi)].map((match) => QUALITY_NAMES.get(match[1].toLowerCase())),
  )];
  const pointCost = costs.find((cost) => Number.isFinite(cost)) ?? 0;
  const upstreamModel = upstreamModels[0] || "";
  const route = {
    id,
    label: line,
    description: "",
    modelFamily,
    line,
    transport: generatePath.includes(":generateContent") ? "gemini-native" : "openai-image",
    mode: trim(row["模式"]) === "异步" ? "async" : "sync",
    baseUrl: trim(row["供应商"]).replace(/\/+$/, ""),
    generatePath,
    ...(taskPath ? { taskPath } : {}),
    ...(editPath ? { editPath } : {}),
    upstreamModel,
    apiKeyEnv: trim(row["线路密钥变量"]),
    pointCost,
    ...(Object.keys(sizeOverrides).length ? { sizeOverrides } : {}),
    ...(supportedQualities?.length ? { supportedQualities } : {}),
    sortOrder: rows.slice(0, index).filter((entry) => {
      const priorName = trim(entry["模型大族"]) || trim(rows.slice(0, rows.indexOf(entry) + 1).reverse().find((item) => trim(item["模型大族"]))?.["模型大族"]);
      return priorName === familyName;
    }).length,
    ...(trim(row.__EMPTY) === "默认线路" ? { isDefaultRoute: true } : {}),
  };
  if (!route.apiKeyEnv) throw new Error(`Missing API key environment variable name for ${id}`);
  if (route.mode === "async" && route.transport === "openai-image" && !taskPath) {
    throw new Error(`Async OpenAI route ${id} must define a task path`);
  }
  return route;
});

const familyNames = [...new Set(routes.map((route) => route.modelFamily))];
for (const family of familyNames) {
  const familyRoutes = routes.filter((route) => route.modelFamily === family);
  if (familyRoutes.filter((route) => route.isDefaultRoute).length !== 1) {
    throw new Error(`Expected one default route for ${family}`);
  }
}
const document = { defaultRouteId: routes.find((route) => route.isDefaultRoute).id, routes };
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${routes.length} routes across ${familyNames.length} model families to ${outputPath}`);
