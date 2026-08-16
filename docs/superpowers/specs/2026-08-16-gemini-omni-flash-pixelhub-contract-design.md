# Gemini Omni Flash PixelHub Contract Repair Design

## Scope

The attached `GEMINI_OMNI_FLASH_PIXELHUB_API.md` is treated as the provider
contract. The user-requested repair applies to this repository's existing
PixelHub video flow, whose equivalent adapter is `videoRequestPolicy.cjs`,
not to a new `packages/ai-gateway-core` package.

Only the Gemini Omni Flash route changes its media aliases. Sora and Veo
aliases remain unchanged.

## Architecture And Data Flow

The browser continues to send the internal fields `referenceImages` and
`referenceVideos`. `normalizePixelHubVideoRequest` validates HTTPS media URLs,
model capabilities, prompt, duration, ratio, and resolution, then constructs a
provider body based on the selected model:

- `gemini-omni-flash`: `image_urls` for images and `video_urls` for source
  video; never duplicate media under any `reference_*` alias.
- `sora-v3-pro`: `reference_image_urls` and `reference_videos`.
- `veo31-fast`: ordered `image_urls` only, with no video alias.

The Gemini body does not include a user-controlled or unconditional
`generate_audio` field. Audio remains implicit on this provider route.

The server keeps the existing `/v1/videos` create and task polling endpoints,
credential lookup, billing order, and tenant asset settlement. Client polling
uses a 12-second interval and a 30-minute deadline.

## Error Handling And Privacy

Validation rejects non-HTTPS media URLs and capability overflows before billing.
Provider responses may use the internal model alias `gemini-omni`; task status
is interpreted from status fields rather than rejected on model-name mismatch.
Provider summaries and logs may include model, status, and reference counts,
but must not include signed media URLs, API keys, request `Authorization`
headers, or raw provider request bodies containing secrets.

## Testing

Focused tests will assert:

1. Gemini image-plus-video serializes exactly to `image_urls` and `video_urls`.
2. Gemini has none of `image_url`, `reference_image_urls`,
   `reference_video`, or `reference_videos`.
3. Gemini image-only mode uses `image_urls`.
4. Sora retains `reference_image_urls` and `reference_videos`.
5. Veo retains ordered `image_urls` only.
6. Summary/log helpers expose reference counts without signed URLs, secrets,
   or Authorization headers.
7. Client polling constants are 12 seconds and 30 minutes.

The focused regression suite and the repository build are required before
completion.
