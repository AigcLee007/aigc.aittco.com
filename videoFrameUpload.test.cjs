const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const url = require("url");

const {
  parseVideoFrameDataUrl,
  normalizeVideoFramePayloadUrls,
  VIDEO_FRAME_UPLOAD_DIR,
} = require("./videoFrameUpload.cjs");

describe("video frame upload helpers", () => {
  it("parses supported image data urls", () => {
    const parsed = parseVideoFrameDataUrl("data:image/jpeg;base64,AQIDBA==");
    assert(parsed);
    assert.strictEqual(parsed.mime, "image/jpeg");
    assert.strictEqual(parsed.ext, "jpg");
    assert.deepStrictEqual(Array.from(parsed.buffer), [1, 2, 3, 4]);
  });

  it("normalizes frame payload urls into public urls", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-frame-upload-"));
    const originalCwd = process.cwd();
    const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    const previousModuleDir = path.dirname(require.resolve("./videoFrameUpload.cjs"));
    const tempModulePath = path.join(baseDir, "videoFrameUpload.cjs");
    process.chdir(baseDir);
    process.env.PUBLIC_BASE_URL = "https://example.com";

    try {
      fs.copyFileSync(path.join(previousModuleDir, "videoFrameUpload.cjs"), tempModulePath);
      const tempRequire = require("module").createRequire(url.pathToFileURL(tempModulePath));
      const tempModule = tempRequire("./videoFrameUpload.cjs");
      const body = {
        start_frame: "data:image/png;base64,AQIDBA==",
        end_frame: "/uploads/video-frames/existing.png",
        video_reference: "/uploads/video-references/ref.mp4",
      };

      tempModule.normalizeVideoFramePayloadUrls(body, {
        get(name) {
          if (String(name).toLowerCase() === "host") return "example.com";
          return "";
        },
        protocol: "https",
      });

      assert.ok(body.start_frame.startsWith("https://example.com/uploads/video-frames/"));
      assert.strictEqual(body.end_frame, "https://example.com/uploads/video-frames/existing.png");
      assert.strictEqual(body.video_reference, "https://example.com/uploads/video-references/ref.mp4");
      assert.ok(fs.existsSync(path.join(baseDir, "uploads", "video-frames")));
    } finally {
      process.chdir(originalCwd);
      if (originalPublicBaseUrl === undefined) {
        delete process.env.PUBLIC_BASE_URL;
      } else {
        process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
      }
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
