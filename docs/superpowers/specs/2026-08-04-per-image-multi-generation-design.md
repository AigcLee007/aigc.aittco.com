# Adobe and VISON Per-Image Generation Design

## Goal

When the user requests `N` images through the Adobe or VISON Nano Banana Pro
routes, submit `N` independent upstream requests. Every request must ask for
exactly one image by using `n: 1` and, for Gemini-native requests,
`candidateCount: 1`.

The existing Official T3 behavior remains unchanged.

## Current Problem

The canvas currently sends one Gemini-native request containing `n: N` and
`candidateCount: N`. Adobe can return only one parsed image while the server
still settles the whole request as successful. The canvas fills the first
placeholder and marks the remaining placeholders as failed.

The production VISON route is also misclassified as `gemini-native`, although
Visionary's OpenAPI endpoint returns image URLs in `results[].url`. This sends
the response through the wrong parser before the canvas can display it.

## Request Flow

For Adobe and VISON, the canvas will create one placeholder and one request per
requested image:

1. Repeat from `0` through `N - 1`.
2. Create one placeholder for the current attempt.
3. Submit one request with `n: 1`.
4. Set `candidateCount: 1` when using the Gemini-native endpoint.
5. Attach a returned task ID, image, or error only to that attempt's
   placeholder.

The requests may run concurrently, matching the current Official T3 behavior.
One failed request must not change the state of another request.

## Route Handling

- Adobe remains a Gemini-native route, but the canvas always sends one image
  per request.
- VISON route `nano-banana-pro-line4` must use `openai-image` with synchronous
  Visionary/OpenAPI response handling and the
  `/openapi/v1/images/generations` generate path, so `results[].url` is parsed
  by the existing generic URL extractor.
- Official T3 remains `openai-image` and asynchronous, with its existing
  per-image request loop.

The production VISON database row must be corrected during rollout because an
existing MySQL route row overrides the repository's static route definition.

## Server Guard

`POST /api/gemini/generate` will resolve the effective image count from `n`,
`candidateCount`, or the camel-case/snake-case generation configuration and
reject a value greater than one before reserving points. The response must
explain that Gemini-native routes accept one image per request.

This matches the existing guard on `POST /api/generate` and prevents direct or
older clients from being charged for an unsupported multi-image request.

## Billing And Errors

Each independent request reserves points for one image. A failed request is
refunded through the existing request failure path, while successful sibling
requests remain charged and visible.

The canvas must not synthesize additional failures from a short multi-image
response because no request expects more than one image.

## Tests

- A request-planning test proves that quantity `3` produces three attempts,
  each with an image count of one.
- A Gemini submission test proves that every Adobe attempt contains `n: 1`
  and `candidateCount: 1`.
- A server test proves that `/api/gemini/generate` rejects an effective image
  count greater than one before billing or upstream submission.
- Existing Official T3 generation tests and the full build must continue to
  pass.

## Rollout Verification

1. Correct the production VISON route to `openai-image / sync` and confirm its
   OpenAPI generation path.
2. Restart the backend and deploy the frontend build.
3. Generate three images on Adobe and confirm three independent successful or
   failed records, each charging at most one image.
4. Generate three images on VISON and confirm three independent requests and
   three displayed image URLs.
5. Generate three images on Official T3 and confirm its existing behavior is
   unchanged.
