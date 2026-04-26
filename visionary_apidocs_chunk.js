import{c as h,r as l,j as e,R as f}from"./index-DfKA79CL.js";import{g as w}from"./generation-costs-BSCW12n4.js";import{K as _}from"./key-round-DelIi-e-.js";import{S as I}from"./shield-B72GWmAn.js";import{W as k}from"./wallet-DYhrDb9u.js";/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]],A=h("external-link",v);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K=[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2",key:"ngkwjq"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2",key:"iecqi9"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6",key:"16zg32"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18",key:"nzw8ys"}]],z=h("server",K),S=[{id:"gpt-image-2",name:"GPT Image 2",ratio:"auto / 16:9 / 9:16 / 1:1 / 3:2 / 2:3",imageSize:"自动"},{id:"Nano_Banana_2",name:"Nano Banana2",ratio:"1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3",imageSize:"2K / 4K"},{id:"Nano_Banana_Pro",name:"Nano Banana Pro",ratio:"1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3",imageSize:"2K / 4K"}],m="VISIONARY_API_KEY";function s({children:r}){return e.jsx("code",{className:"rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[0.656em] font-semibold text-sky-200",children:r})}function E(r){return r.split(new RegExp(`(${m})`,"g")).map((n,o)=>n===m?e.jsx("span",{className:"font-semibold text-sky-300",children:n},`${n}-${o}`):e.jsx(f.Fragment,{children:n},`${n}-${o}`))}function a({children:r}){return e.jsx("pre",{className:"overflow-x-auto rounded-[28px] border border-white/10 bg-black/40 px-5 py-5 text-[0.7rem] leading-[1.2rem] text-zinc-200",children:e.jsx("code",{children:E(r)})})}function x(r){const c=r.method==="POST"?"bg-emerald-500/12 text-emerald-200 border-emerald-400/20":"bg-sky-500/12 text-sky-200 border-sky-400/20";return e.jsxs("article",{className:"rounded-[28px] border border-white/10 bg-black/25 p-5 md:p-6 space-y-3",children:[e.jsxs("div",{className:"flex flex-wrap items-center gap-3",children:[e.jsx("span",{className:`rounded-full border px-3 py-1 text-[8.8px] font-bold uppercase tracking-[0.22em] ${c}`,children:r.method}),e.jsx("code",{className:"text-[0.7rem] font-semibold text-sky-200",children:r.path})]}),e.jsx("h3",{className:"text-[1rem] font-bold text-white",children:r.title}),e.jsx("p",{className:"text-[0.7rem] leading-[1.2rem] text-zinc-400",children:r.description})]})}const G=()=>{const r=l.useMemo(()=>{const t="".trim().replace(/\/+$/,"");if(t)return t;if(typeof window>"u")return"https://visionary.beer";const i=window.location.origin.replace(/\/+$/,"");return i.includes("localhost")||i.includes("127.0.0.1")?"https://visionary.beer":i},[]),c=l.useMemo(()=>`const VISIONARY_API_KEY = '请替换成您拿到的 API Key';
const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2);

const response = await fetch('${r}/openapi/v1/images/generations', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + VISIONARY_API_KEY,
    'Idempotency-Key': requestId,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: '一只电影感极强的赛博朋克橘猫，霓虹雨夜，超高细节',
    model: 'Nano_Banana_2',
    ratio: '1:1',
    imageSize: '2K',
    images: []
  })
});

const result = await response.json();
if (!response.ok) {
  throw new Error(result.error || '生成失败');
}

const imageUrl = result.results?.[0]?.url;`,[r]),n=l.useMemo(()=>`const VISIONARY_API_KEY = '请替换成您拿到的 API Key';

const response = await fetch('${r}/v1beta/models/Nano_Banana_Pro:generateContent', {
  method: 'POST',
  headers: {
    'x-goog-api-key': VISIONARY_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { text: '一只电影感极强的赛博朋克橘猫，霓虹雨夜，超高细节' }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '1:1',
        imageSize: '2K'
      }
    }
  })
});

const result = await response.json();
if (!response.ok) {
  throw new Error(result.error?.message || result.error || '生成失败');
}

const imageUrl = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
if (!imageUrl) {
  throw new Error('响应中没有图片链接，请保留 responseId 联系排查');
}`,[r]),o=l.useMemo(()=>`const VISIONARY_API_KEY = '请替换成您拿到的 API Key';

const response = await fetch('${r}/openapi/v1/account', {
  method: 'GET',
  headers: {
    Authorization: 'Bearer ' + VISIONARY_API_KEY
  }
});

const account = await response.json();
if (!response.ok) {
  throw new Error(account.error || '查询 API Key 状态失败');
}

const remainingCredits = account.apiKey.remainingCredits;`,[r]),p=l.useMemo(()=>`const VISIONARY_API_KEY = '请替换成您拿到的 API Key';

const response = await fetch('${r}/openapi/v1/images/generations?page=1&limit=20', {
  method: 'GET',
  headers: {
    Authorization: 'Bearer ' + VISIONARY_API_KEY
  }
});

const records = await response.json();
if (!response.ok) {
  throw new Error(records.error || '查询生图记录失败');
}

const imageUrls = records.data.flatMap((item) => {
  return item.results.map((result) => result.url);
});`,[r]),g=l.useMemo(()=>`curl -X POST '${r}/openapi/v1/images/generations' \\
  -H 'Authorization: Bearer VISIONARY_API_KEY' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"prompt":"一只电影感极强的赛博朋克橘猫，霓虹雨夜，超高细节","model":"Nano_Banana_2","ratio":"1:1","imageSize":"2K","images":[]}'`,[r]),j=`{
  "id": "16-0b731f17-f8b4-4a91-a888-9d4fb871bc04",
  "results": [
    {
      "url": "https://file1.aitohumanize.com/file/1b3ee3783ce64ce6b757d8efecd28431.png",
      "content": ""
    }
  ],
  "progress": 100,
  "status": "succeeded",
  "failure_reason": "",
  "error": "",
  "callback_url": "-1",
  "start_time": 1776481872,
  "end_time": 1776481964
}`,b=`{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [
          {
            "inlineData": {
              "mimeType": "image/png",
              "data": "https://file1.aitohumanize.com/file/1b3ee3783ce64ce6b757d8efecd28431.png"
            }
          }
        ]
      },
      "finishReason": "STOP",
      "index": 0
    }
  ],
  "responseId": "16-0b731f17-f8b4-4a91-a888-9d4fb871bc04",
  "modelVersion": "Nano_Banana_Pro",
  "status": "succeeded",
  "progress": 100,
  "usageMetadata": {
    "promptTokenCount": 0,
    "candidatesTokenCount": 0,
    "totalTokenCount": 0
  }
}`,u=`{
  "apiKey": {
    "status": "active",
    "totalCredits": 1000,
    "remainingCredits": 820,
    "isActive": true,
    "lastUsedAt": "2026-04-19T08:30:00.000Z"
  }
}`,N=`{
  "data": [
    {
      "id": "16-0b731f17-f8b4-4a91-a888-9d4fb871bc04",
      "results": [
        {
          "url": "https://file1.aitohumanize.com/file/1b3ee3783ce64ce6b757d8efecd28431.png",
          "content": ""
        }
      ],
      "progress": 100,
      "status": "succeeded",
      "failure_reason": "",
      "error": "",
      "callback_url": "-1",
      "start_time": 1776481872,
      "end_time": 1776481964,
      "prompt": "一只电影感极强的赛博朋克橘猫",
      "model": "Nano_Banana_2",
      "ratio": "1:1",
      "image_size": "2K",
      "created_at": 1776481872,
      "updated_at": 1776481964,
      "completed_at": 1776481964
    }
  ],
  "page": 1,
  "limit": 20,
  "hasMore": false
}`,y=[["example-account-request","查询 Key 状态"],["example-account-response","Key 状态响应"],["example-create-request","发起生图请求"],["example-create-response","生图成功响应"],["example-gemini-request","Gemini 格式请求"],["example-gemini-response","Gemini 格式响应"],["example-records-request","查询生图记录"],["example-records-response","生图记录响应"],["example-read-image","读取图片链接"],["example-auth-header","认证请求头"],["example-curl-test","命令行测试"]];return e.jsx("div",{className:"min-h-screen bg-[#050505] px-4 pb-20 pt-28 md:px-6 md:pt-32",children:e.jsxs("div",{className:"mx-auto grid max-w-[1740px] gap-6 lg:grid-cols-[190px_minmax(0,0.95fr)_minmax(380px,0.72fr)] xl:grid-cols-[220px_minmax(0,1.05fr)_520px]",children:[e.jsx("nav",{className:"lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto",children:e.jsxs("section",{className:"rounded-[28px] border border-white/10 bg-black/30 p-4",children:[e.jsx("div",{className:"mb-3 text-[0.6rem] font-bold uppercase tracking-[0.22em] text-zinc-500",children:"示例导航"}),e.jsx("div",{className:"grid gap-2",children:y.map(([t,i],d)=>e.jsxs("a",{href:`#${t}`,className:"rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2 text-[0.7rem] leading-[1rem] text-zinc-300 transition hover:border-sky-400/30 hover:bg-sky-400/10 hover:text-sky-100",children:[e.jsx("span",{className:"mr-2 text-[0.6rem] font-bold text-sky-300",children:d+1}),i]},t))})]})}),e.jsxs("aside",{className:"space-y-5 lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-2",children:[e.jsx("div",{className:"mb-5 text-[0.7rem] font-bold leading-[1rem] text-sky-300",children:"购买key额度联系微信客服：ocopizzas"}),e.jsxs("section",{className:"rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.2),transparent_38%),rgba(255,255,255,0.035)] p-5 md:p-6",children:[e.jsx("div",{className:"mb-5 flex items-center justify-between gap-4",children:e.jsxs("div",{children:[e.jsxs("div",{className:"inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-[0.6rem] font-bold uppercase tracking-[0.2em] text-sky-200",children:[e.jsx(_,{size:14}),"Code Samples"]}),e.jsxs("p",{className:"mt-4 text-[0.7rem] leading-[1.2rem] text-zinc-400",children:["示例里的 ",e.jsx(s,{children:"VISIONARY_API_KEY"})," 是占位符，请替换成您拿到的 API Key。"]})]})}),e.jsxs("div",{className:"space-y-5",children:[e.jsxs("div",{id:"example-account-request",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"1. 查询 Key 状态"}),e.jsx(a,{children:o})]}),e.jsxs("div",{id:"example-account-response",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"2. Key 状态响应"}),e.jsx(a,{children:u})]}),e.jsxs("div",{id:"example-create-request",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"3. 服务端发起生图请求"}),e.jsx(a,{children:c})]}),e.jsxs("div",{id:"example-create-response",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"4. 成功响应"}),e.jsx(a,{children:j})]}),e.jsxs("div",{id:"example-gemini-request",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"5. Gemini 兼容格式请求"}),e.jsx(a,{children:n})]}),e.jsxs("div",{id:"example-gemini-response",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"6. Gemini 兼容格式响应"}),e.jsx(a,{children:b})]}),e.jsxs("div",{id:"example-records-request",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"7. 查询生图记录"}),e.jsx(a,{children:p})]}),e.jsxs("div",{id:"example-records-response",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"8. 生图记录响应"}),e.jsx(a,{children:N})]}),e.jsxs("div",{id:"example-read-image",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"读取图片链接"}),e.jsx(a,{children:`// 标准开放 API
const imageUrl = result.results?.[0]?.url;

// Gemini 兼容接口
const geminiImageUrl = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;`})]}),e.jsxs("div",{id:"example-auth-header",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"认证请求头"}),e.jsx(a,{children:`Authorization: Bearer VISIONARY_API_KEY

// 如果您的项目原来是 Gemini 风格，也可以用这个请求头：
x-goog-api-key: VISIONARY_API_KEY`})]}),e.jsxs("div",{id:"example-curl-test",className:"scroll-mt-28 space-y-3",children:[e.jsx("h2",{className:"text-[0.9rem] font-bold text-white",children:"命令行快速测试"}),e.jsx(a,{children:g})]})]})]})]}),e.jsxs("main",{className:"space-y-6",children:[e.jsx("section",{className:"grid gap-3 sm:grid-cols-2 xl:grid-cols-4",children:[["1","保存 Key","把 API Key 放在后端环境变量里，不要暴露到浏览器。"],["2","查额度","调用账户接口确认 Key 可用，并读取剩余额度。"],["3","发起生成","提交一次请求，接口会等待上游生成完成后返回图片链接。"],["4","读取记录","从生成响应或记录接口的 results[0].url 读取图片链接。"]].map(([t,i,d])=>e.jsxs("article",{className:"rounded-[24px] border border-white/10 bg-white/[0.03] p-4",children:[e.jsx("div",{className:"mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-sky-400/15 text-[0.7rem] font-black text-sky-200",children:t}),e.jsx("h2",{className:"font-semibold text-white",children:i}),e.jsx("p",{className:"mt-2 text-[0.7rem] leading-[1.2rem] text-zinc-400",children:d})]},t))}),e.jsx("section",{className:"grid gap-4",children:[{icon:e.jsx(I,{size:18,className:"text-emerald-300"}),title:"请在服务端调用",body:e.jsxs(e.Fragment,{children:["请不要把 ",e.jsx(s,{children:"VISIONARY_API_KEY"})," 写进网页前端代码。前端直连会暴露密钥，也容易被盗刷额度。"]})},{icon:e.jsx(k,{size:18,className:"text-sky-300"}),title:"额度按 Key 独立计算",body:e.jsxs(e.Fragment,{children:["每个 ",e.jsx(s,{children:"API Key"})," 都有独立额度。生成成功会按模型扣减，额度不足时接口会拒绝继续生成。"]})},{icon:e.jsx(z,{size:18,className:"text-amber-300"}),title:"返回上游兼容格式",body:e.jsxs(e.Fragment,{children:["成功响应和生图记录里的图片链接都在 ",e.jsx(s,{children:"results[0].url"}),"，请直接保存或展示这个地址；",e.jsx(s,{children:"id"})," 可用于您自己的日志定位。"]})},{icon:e.jsx(A,{size:18,className:"text-cyan-300"}),title:"兼容 Gemini 项目格式",body:e.jsxs(e.Fragment,{children:["如果您的项目已经按 Gemini 的 ",e.jsx(s,{children:"generateContent"})," 格式写好，只需要把请求地址换成我们的兼容地址，并把图片 URL 从 ",e.jsx(s,{children:"candidates[0].content.parts[0].inlineData.data"})," 读取出来；这里返回的是 URL，不是 base64。"]})}].map(t=>e.jsx("article",{className:"rounded-[24px] border border-white/10 bg-black/25 p-4",children:e.jsxs("div",{className:"flex items-start gap-3",children:[e.jsx("div",{className:"mt-0.5",children:t.icon}),e.jsxs("div",{className:"space-y-1",children:[e.jsx("h2",{className:"font-semibold text-white",children:t.title}),e.jsx("p",{className:"text-[0.7rem] leading-[1.2rem] text-zinc-400",children:t.body})]})]})},t.title))}),e.jsxs("section",{className:"grid gap-4",children:[e.jsx(x,{method:"POST",path:"/openapi/v1/images/generations",title:"创建并同步返回生图结果",description:e.jsxs(e.Fragment,{children:["提交 ",e.jsx(s,{children:"prompt"}),"、",e.jsx(s,{children:"model"}),"、",e.jsx(s,{children:"ratio"})," 等参数创建图片。成功时直接读取 ",e.jsx(s,{children:"results[0].url"}),"。"]})}),e.jsx(x,{method:"POST",path:"/v1beta/models/{model}:generateContent",title:"Gemini 兼容生图接口",description:e.jsxs(e.Fragment,{children:["适合已经按 Gemini 请求格式开发好的项目。提交 ",e.jsx(s,{children:"contents"})," 和 ",e.jsx(s,{children:"generationConfig.imageConfig"}),"，成功时从 ",e.jsx(s,{children:"inlineData.data"})," 读取图片 URL；这里返回的是 URL，不是 base64。"]})})]}),e.jsxs("section",{className:"space-y-4 rounded-[32px] border border-white/10 bg-zinc-900/70 p-5 md:p-6",children:[e.jsx("h2",{className:"text-[1.2rem] font-bold text-white",children:"参数说明"}),e.jsx("div",{className:"grid gap-3",children:[["prompt",e.jsx(e.Fragment,{children:"必填。请填写图片描述，最大 3000 字符。描述越清晰，生成结果越稳定。"})],["model",e.jsxs(e.Fragment,{children:["可选。默认使用 ",e.jsx(s,{children:"gpt-image-2"}),"。如果您需要更高质量，可以选择 Nano Banana 系列。"]})],["ratio",e.jsxs(e.Fragment,{children:["可选。默认 ",e.jsx(s,{children:"1:1"}),"。请先确认所选模型支持这个比例。"]})],["imageSize",e.jsxs(e.Fragment,{children:["可选。",e.jsx(s,{children:"gpt-image-2"})," 会忽略该参数；Nano Banana 系列支持 ",e.jsx(s,{children:"2K"})," / ",e.jsx(s,{children:"4K"}),"。"]})],["images",e.jsx(e.Fragment,{children:"可选。JSON 模式可传 data URI 或 https 图片 URL；表单模式可上传最多 9 张参考图。"})],["contents",e.jsxs(e.Fragment,{children:["Gemini 兼容接口必填。请把提示词放在 ",e.jsx(s,{children:"contents[0].parts[0].text"}),"；如果有参考图，可以放在 ",e.jsx(s,{children:"inlineData.data"}),"，支持 base64、data URI 或 https 图片 URL。"]})],["generationConfig.imageConfig",e.jsxs(e.Fragment,{children:["Gemini 兼容接口可选。",e.jsx(s,{children:"aspectRatio"})," 会映射为我们的 ",e.jsx(s,{children:"ratio"}),"；",e.jsx(s,{children:"imageSize"})," 会映射为我们的 ",e.jsx(s,{children:"imageSize"}),"。"]})],["Idempotency-Key",e.jsx(e.Fragment,{children:"可选。正常接入可以不传，只需要等待本次请求返回图片；如果您的系统会自动重试请求，建议每次新生图带一个唯一值，避免网络超时后重复扣额度。"})],["Authorization",e.jsxs(e.Fragment,{children:["推荐认证方式。格式为 ",e.jsx(s,{children:"Bearer + VISIONARY_API_KEY 的值"}),"，请只在服务端保存和使用。"]})],["x-goog-api-key",e.jsxs(e.Fragment,{children:["Gemini 兼容认证方式。如果您的项目原来就是 Gemini 风格，可以把 ",e.jsx(s,{children:"VISIONARY_API_KEY"})," 放到这个请求头。"]})],["page",e.jsxs(e.Fragment,{children:["查询生图记录时可选。默认 ",e.jsx(s,{children:"1"}),"，最大会限制到 ",e.jsx(s,{children:"500"}),"，避免异常翻页拖慢接口。"]})],["limit",e.jsxs(e.Fragment,{children:["查询生图记录时可选。默认 ",e.jsx(s,{children:"20"}),"，最大 ",e.jsx(s,{children:"50"}),"。"]})],["id",e.jsx(e.Fragment,{children:"响应里的任务编号。它用于您自己的日志记录和排查问题，记录接口也会返回同样格式的编号。"})]].map(([t,i])=>e.jsxs("div",{className:"rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-[0.7rem] text-zinc-300",children:[e.jsx("div",{children:e.jsx(s,{children:t})}),e.jsx("div",{className:"mt-2 leading-6 text-zinc-400",children:i})]},t))})]}),e.jsxs("section",{className:"space-y-5 rounded-[32px] border border-white/10 bg-zinc-900/70 p-5 md:p-6",children:[e.jsxs("div",{className:"space-y-2",children:[e.jsx("h2",{className:"text-[1.2rem] font-bold text-white",children:"支持模型与额度消耗"}),e.jsxs("p",{className:"text-[0.7rem] leading-[1.2rem] text-zinc-400",children:["不同 ",e.jsx(s,{children:"model"})," 会消耗不同额度。调用前请确认您的",e.jsx(s,{children:"API Key"})," 还有足够余额；额度不足时，接口会返回错误，不会继续调用上游。"]})]}),e.jsx("div",{className:"overflow-x-auto",children:e.jsxs("table",{className:"min-w-full border-collapse text-[0.7rem]",children:[e.jsx("thead",{children:e.jsx("tr",{className:"text-left text-[0.6rem] font-bold uppercase tracking-[0.12em] text-zinc-500",children:["模型","model 参数","支持比例","支持分辨率","每次消耗额度"].map(t=>e.jsx("th",{className:"whitespace-nowrap border-b border-white/10 px-4 py-3",children:t==="model 参数"?e.jsx(s,{children:"model"}):t},t))})}),e.jsx("tbody",{className:"divide-y divide-white/5",children:S.map(t=>e.jsxs("tr",{className:"text-zinc-300",children:[e.jsx("td",{className:"border-b border-white/5 bg-black/20 px-4 py-4 font-semibold text-white",children:t.name}),e.jsx("td",{className:"border-b border-white/5 bg-black/20 px-4 py-4",children:e.jsx(s,{children:t.id})}),e.jsx("td",{className:"border-b border-white/5 bg-black/20 px-4 py-4",children:t.ratio}),e.jsx("td",{className:"border-b border-white/5 bg-black/20 px-4 py-4",children:t.imageSize}),e.jsxs("td",{className:"border-b border-white/5 bg-black/20 px-4 py-4",children:[w(t.id)," 点"]})]},t.id))})]})})]})]})]})})};export{G as ApiDocs};
