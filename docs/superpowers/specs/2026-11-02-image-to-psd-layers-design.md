# AI Image Separation to PSD Design

## Goal

Let a user turn one flattened canvas image into an editable PSD with automatically
identified object layers, an AI-filled background, and an optional hidden copy
of the source image.

## User Flow

1. From an image node's context menu, choose **Separate layers and export PSD**.
2. The app reads the original image bytes and submits one separation job.
3. While the job runs, show progress and allow cancellation where the provider
   supports it. The canvas source node is not modified.
4. Show the detected layer names and previews. The user may rename or remove
   object layers, then export or cancel.
5. Export a PSD at the source image's pixel dimensions. The PSD contains the
   reconstructed background at the bottom, object layers in detected depth
   order, and the untouched source image as a hidden backup layer.

The first version supports one still image at a time. It does not support manual
mask painting, video, batch jobs, or inserting the generated layers back onto
the canvas.

## Processing Design

- Add a server-side separation service behind a provider adapter. The provider
  contract must return semantic labels, soft instance masks aligned to the
  original image coordinates, visible-pixel masks without duplicated hidden
  regions, front-to-back layer order, and a background-reconstruction result.
  V1 uses one server-configured provider integration that satisfies this
  contract; provider credentials remain on the server. If it is not configured,
  disable the action with an actionable error instead of falling back to image
  generation.
- Use object detection plus instance segmentation to find the main visible
  objects. Do not use the existing image-edit prompt path to generate separate
  object images: it can redraw pixels and lose alignment with the source.
- Apply each soft mask to the original source pixels to produce transparent
  object layers. Use the provider's reconstruction only for the bottom
  background layer. Keep the original source unchanged as a hidden recovery
  layer.
- Expose an authenticated asynchronous job API for upload, status, cancellation,
  and result retrieval. Reuse the existing image-job task and asset delivery
  infrastructure where its contracts fit; keep segmentation-specific payloads
  in a dedicated service instead of treating masks as ordinary generated
  images. Use binary assets or compact masks rather than large base64 JSON.
- Write the PSD in the browser with `ag-psd`. Preserve full source dimensions,
  layer bounds, transparency, labels, and stacking order. The frontend owns PSD
  assembly and download; the server does not need to persist the final PSD.

## Review UI and Output Rules

- The review step shows the source composite and the detected object layers.
- Renaming changes only the PSD layer name. Removing a layer excludes it from
  the PSD and causes the background reconstruction to remain visible there.
- The reconstructed background is always visible and the source backup layer is
  hidden by default.
- If no useful object masks are returned, the job fails with a recoverable
  message and offers the unchanged source download; it must not produce a
  misleading one-layer PSD.
- The original canvas node and its history remain unchanged on success,
  cancellation, or failure.

## Constraints and Failure Handling

- A single flattened image cannot reveal true pixels hidden behind an object.
  The background model estimates those pixels; warn in the review UI that moved
  objects may expose generated content.
- Validate MIME type, dimensions, file size, mask dimensions, and layer count
  before processing or PSD assembly. Reject unsupported or oversized inputs
  with an actionable message.
- Bound concurrent jobs and enforce the same authentication, request limits,
  and usage accounting used by existing image jobs. Never expose provider keys
  to the browser.
- Treat provider timeouts, partial masks, invalid masks, and background-fill
  failures as job errors. Release temporary assets and object URLs when the
  user cancels, closes the review, or completes export.
- Estimate memory before assembling full-resolution RGBA layers. Process image
  work sequentially and reject files that exceed the configured browser memory
  budget rather than freezing the canvas.

## Validation

- Unit-test mask alignment and alpha application against small deterministic
  fixtures, including soft edges and multiple overlapping objects.
- Test the provider adapter with mocked success, no-object, malformed-mask,
  timeout, cancellation, and partial-failure responses.
- Test review edits and verify removed/renamed layers are reflected in the PSD
  document model.
- Verify the exported PSD opens in Photoshop-compatible software, has the
  original dimensions and correct layer order/visibility, and composites over
  the reconstructed background without losing source foreground pixels.
- Manually inspect representative photos, illustrations, hair/transparent
  edges, and large inputs before enabling the feature in production.
