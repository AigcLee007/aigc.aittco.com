# PixelHub Three-Model Video Integration Design

## Goal

Integrate these three PixelHub video models while retaining all existing video
model and route records in an inactive state:

- `gemini-omni-flash`
- `sora-v3-pro`
- `veo31-fast`

Only these three models and their routes will be active and visible in the
user-facing application. Existing video generation history, pending-task data,
billing ledger entries, and user data remain unchanged.

All three models share the same upstream API contract:

- Create: `POST https://api.pixellelabs.com/v1/videos`
- Poll: `GET https://api.pixellelabs.com/v1/videos/{task_id}`

Each model uses an independent server-side API key:

- `PIXELHUB_GEMINI_OMNI_FLASH_KEY`
- `PIXELHUB_SORA_V3_PRO_KEY`
- `PIXELHUB_VEO31_FAST_KEY`

The keys are already configured in the production `.env`. Their values must
never be stored in static configuration, returned to the browser, or written to
logs.

## Scope

This release supports text prompts, reference images, and reference videos as
allowed by each model. Reference audio is explicitly out of scope. Output audio
is always enabled by sending `generate_audio: true`; the UI does not expose a
toggle.

Video quantity remains fixed at one result per generation request.

## Recommended Architecture

Use a capability-driven model catalog plus one shared PixelHub request adapter.
The catalog defines each model's supported inputs and UI choices. The adapter
uses those capabilities to validate and construct the exact upstream request.
Small model-specific branches are allowed for differences in reference-media
semantics, but model rules must not be scattered across React components,
stores, and billing code.

This approach is preferred over hard-coded component checks because the current
schema cannot express resolution choices or video-reference limits, and the
existing client already contains conflicting Sora and Veo special cases. A full
adapter class per model is unnecessary because all three models use the same
endpoint, authentication style, task response, and polling protocol.

## Capability Matrix

| Capability | Gemini Omni Flash | Sora V3 Pro | Veo 3.1 Fast |
| --- | --- | --- | --- |
| Model ID | `gemini-omni-flash` | `sora-v3-pro` | `veo31-fast` |
| Upstream model | `gemini-omni-flash` | `sora-v3-pro` | `veo31-fast` |
| Default aspect ratio | `16:9` | `16:9` | `16:9` |
| Aspect ratios | `16:9`, `9:16` | `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` | `16:9`, `9:16` |
| Default resolution | `720p` | `720p` | `1080p` |
| Resolutions | `720p`, `1080p` | `720p` only | `720p`, `1080p` |
| Default duration | 4 seconds | 4 seconds | 4 seconds |
| Durations | `4`, `6`, `8`, `10` | every integer from `4` through `15` | `4`, `6`, `8` |
| Reference images | up to 5 style references | up to 9 general references | up to 2 frame references |
| Reference videos | up to 1 source video | up to 3 reference videos | unsupported |
| Combined references | up to 6 | up to 12 | up to 2 |
| Prompt limit | no additional model-specific cap | 2500 characters | no additional model-specific cap |
| Output audio | always enabled | always enabled | always enabled |
| Pricing | 1 point/second | 10 points/second | 0.5 points/second |
| Minimum charge | 4 points | 40 points | 2 points |

The Sora combined-reference rule is the sum of image and video references for
this release. Reference audio is not counted because it is not accepted by the
application.

## Model Data Shape

Extend the video model catalog and `video_models` table with these fields:

- `resolution_options_json`: ordered supported resolution values.
- `default_resolution`: the resolution selected when entering the model.
- `max_reference_videos`: maximum accepted reference videos.
- `max_total_references`: maximum image and video references combined.
- `reference_image_mode`: one of `style`, `general`, or `frames`.
- `supports_video_reference`: whether the reference-video control is visible.
- `prompt_max_length`: positive model-specific limit, or null for the
  application default.

Existing fields continue to define aspect ratios, durations, image-reference
limits, per-second pricing, activation, default selection, and sort order.

The three reference-image modes mean:

- `style`: Gemini style references.
- `general`: Sora general image references.
- `frames`: Veo first-frame and last-frame references in upload order.

The frontend TypeScript shape, backend row mapper, management validators, admin
service types, and admin model editor must expose the same fields. Public model
catalog responses may expose capabilities but never route secrets.

## Model And Route Records

The active records are:

1. `gemini-omni-flash`
   - Route family: `gemini-omni-flash`
   - Request model: `gemini-omni-flash`
   - Pricing mode: `per_second`
   - Point cost per second: `1`
   - Default model: yes
   - Sort order: 0

2. `sora-v3-pro`
   - Route family: `sora-v3-pro`
   - Request model: `sora-v3-pro`
   - Pricing mode: `per_second`
   - Point cost per second: `10`
   - Default model: no
   - Sort order: 1

3. `veo31-fast`
   - Route family: `veo31-fast`
   - Request model: `veo31-fast`
   - Pricing mode: `per_second`
   - Point cost per second: `0.5`
   - Default model: no
   - Sort order: 2

Each model has exactly one active route:

| Route ID | Route family | Upstream model | API key environment variable |
| --- | --- | --- | --- |
| `gemini-omni-flash-line1` | `gemini-omni-flash` | `gemini-omni-flash` | `PIXELHUB_GEMINI_OMNI_FLASH_KEY` |
| `sora-v3-pro-line1` | `sora-v3-pro` | `sora-v3-pro` | `PIXELHUB_SORA_V3_PRO_KEY` |
| `veo31-fast-line1` | `veo31-fast` | `veo31-fast` | `PIXELHUB_VEO31_FAST_KEY` |

All three routes use:

```text
transport: openai-video
mode: async
baseUrl: https://api.pixellelabs.com
generatePath: /v1/videos
taskPath: /v1/videos/{taskId}
line: line1
isDefaultRoute: true
allowUserApiKeyWithoutLogin: false
```

The route-level `pointCost` is set to the model's four-second minimum charge as
a defensive fallback: 4, 40, and 2 respectively. Normal billing always uses the
active model's `pointCostPerSecond` multiplied by the validated duration.

## Frontend State And Controls

Replace `videoHd: boolean` with an explicit `videoResolution` value. Persisted
legacy state is migrated as follows:

- A previous true HD value becomes `1080p` when supported.
- A previous false HD value becomes `720p` when supported.
- Otherwise use the selected model's default resolution.

Replace the single `videoReferenceUrl` with `videoReferenceVideos[]`. Each item
contains the uploaded public URL plus the local display metadata needed for
preview and removal.

The UI is generated from model capabilities:

- Gemini shows two ratios, two resolutions, four durations, up to five image
  references, and one video reference.
- Sora shows six ratios, fixed 720p, every integer duration from 4 through 15,
  up to nine image references, and up to three video references.
- Veo shows two ratios, two resolutions, three durations, and a two-slot frame
  strip labelled first frame and last frame. It does not show video references.

The old Sora image/frame mode switch is removed. Sora always uses general image
references. Veo frame semantics are implicit in image order.

Switching models selects legal defaults when the current aspect ratio,
resolution, or duration is unsupported. Excess reference media remains in local
state, but submission is blocked with a clear count-limit message until the user
removes the excess media or switches to a compatible model. Switching a model
must not silently delete local assets or truncate the submitted reference list.

The model selector and pricing UI read the active catalog dynamically. Remove
hard-coded legacy model rows from the pricing modal. Estimated cost is
`duration * pointCostPerSecond` and updates immediately when duration changes.

## Reference Media Handling

PixelHub's documented reference fields contain URLs. The application must not
forward browser-only blob URLs or large base64 values to PixelHub.

Reference images are compressed on the client and uploaded to the application.
The backend stores them under a public upload path and returns absolute HTTP or
HTTPS URLs. Extend the existing video-frame materialization code to normalize
arrays, not only `start_frame` and `end_frame` fields.

Reference videos use the existing video upload endpoint, extended to support a
list in frontend state. The existing per-file validation remains in force. The
server returns an absolute public URL for every uploaded video.

`PUBLIC_BASE_URL` must be configured correctly in production so PixelHub can
download reference media. Forwarded host/protocol inference remains a fallback,
not the preferred production configuration.

## PixelHub Request Contract

The shared request fields are:

```json
{
  "model": "upstream-model-name",
  "prompt": "original user prompt",
  "aspect_ratio": "16:9",
  "duration": 4,
  "resolution": "720p",
  "generate_audio": true
}
```

Do not append `--ar` to the prompt. The prompt sent upstream is the user's
normalized prompt, while aspect ratio is represented only by `aspect_ratio`.

Model-specific references are:

- Gemini: `reference_image_urls` and `reference_videos`.
- Sora: `reference_image_urls` and `reference_videos`.
- Veo: `image_urls`, where element zero is the first frame and element one is
  the last frame.

Do not send the currently used `video_reference`, `start_frame`, or `end_frame`
fields. Do not send unsupported empty arrays or client-only fields.

The server chooses `model` from the resolved route and model records. It does
not trust a client-supplied upstream model name.

## Server Validation And Billing Order

The video generation endpoint follows this order:

1. Authenticate the application user.
2. Resolve an active video model.
3. Resolve an active video route.
4. Verify that the route family matches the model route family.
5. Normalize the public request shape.
6. Validate all model capabilities.
7. Calculate the point cost.
8. Reserve points.
9. Resolve the route API key and call PixelHub.
10. Store a local task token containing the route ID and upstream task ID.
11. Poll every 10 seconds with the original route and therefore the original API
    key, with the existing 15-minute overall timeout.
12. Complete the generation record or refund the reservation on failure.

Validation before billing includes:

- Model and route are active and correctly associated.
- Aspect ratio, resolution, and integer duration are supported.
- Image, video, and combined reference counts are within limits.
- Veo contains no video references.
- Sora prompt length is at most 2500 characters.
- Every reference is an absolute HTTP or HTTPS URL after materialization.
- Quantity is one.
- `generate_audio` is forced to true regardless of client input.

Validation errors return a clear HTTP 400 response and do not reserve points.
Missing configured route keys are deployment errors and must not fall back to a
different model's key or a browser-supplied key.

For valid requests, billing is:

```text
Gemini: duration * 1
Sora:   duration * 10
Veo:    duration * 0.5
```

The route fixed cost is used only if model metadata is unavailable due to a
defensive fallback. Upstream creation failures are refunded immediately. Failed
or timed-out asynchronous tasks are settled through the existing pending-task
refund path.

## Data Migration

Add an explicit one-time migration command:

```text
node scripts/activate-pixelhub-video-models.cjs
```

The migration is transactional and idempotent:

1. Ensure the new model capability columns exist.
2. Set all existing `video_models` rows to inactive and clear their default
   flags.
3. Set all existing `video_routes` rows to inactive and clear their default
   flags.
4. Upsert the three target model records with the complete capability and
   pricing definitions.
5. Upsert the three target route records with the PixelHub URLs, model names,
   and environment variable names.
6. Set `api_key = NULL` on the three target routes so stale database secrets
   cannot override the configured environment keys.
7. Activate the three target models and routes.
8. Mark Gemini and its route as the defaults.

The migration does not delete rows and does not update generation history,
pending tasks, billing records, or users. Re-running it produces the same
catalog and does not create duplicates.

Do not run the global deactivation in normal startup schema initialization.
Doing so would disable future administrator-created models every time the
service restarts.

Update the static JSON catalogs to the same state: retain existing entries as
inactive and make only the three target models and routes active. This keeps
non-MySQL development and fresh bootstrap behavior aligned with production.

## Admin Management

Extend the video model editor to manage the new capability fields. Validate
that defaults are members of their option arrays and that reference limits are
non-negative and internally consistent.

The route editor continues to expose the API key environment variable name. It
must not expose the environment variable value. Existing inactive models and
routes remain visible to administrators for audit and possible future reuse,
while public catalogs return only active records.

## Error Handling

User-facing validation messages identify the invalid field and allowed values.
Reference uploads report per-file errors without removing other successful
uploads. Switching models reports excluded over-limit references before
submission.

Unknown upstream statuses continue polling within the existing timeout while
being logged with route and model IDs. Logs may include reference counts and
field names, but not API keys, authorization headers, full base64 payloads, or
complete sensitive URLs.

## Testing

Automated coverage includes:

- Capability normalization and database row mapping for all new fields.
- Exact request payload tests for Gemini, Sora, and Veo.
- Gemini boundaries: five images plus one video.
- Sora boundaries: nine images plus three videos and the combined limit.
- Veo boundaries: first frame, optional last frame, and no video references.
- Every invalid aspect ratio, resolution, duration, and reference-count path.
- Sora 2500-character prompt boundary.
- Validation executes before point reservation.
- Four-second charges are exactly 4, 40, and 2 points.
- Every route resolves its own environment variable and never another model's
  key.
- Task polling preserves the creating route.
- Upstream creation failure, polling failure, and timeout refund behavior.
- Migration idempotency, inactive legacy records, active target records, stale
  target database keys cleared, and unrelated historical tables unchanged.
- Frontend model switching, control visibility, default correction, cost
  display, and reference limits.
- Reference upload conversion to publicly reachable HTTP or HTTPS URLs.

Production smoke tests create one four-second task per model and verify output,
route selection, API key selection through sanitized logs, and charged points.
Additional smoke tests cover Gemini with a source video, Sora with multiple
images and videos, and Veo with first and last frames.

## Deployment And Rollback

Deployment sequence:

1. Back up `video_models` and `video_routes`.
2. Verify the three environment variables are present without printing values.
3. Verify `PUBLIC_BASE_URL` resolves publicly.
4. Deploy the application and apply schema changes.
5. Run `scripts/activate-pixelhub-video-models.cjs` once.
6. Restart the application.
7. Confirm the public catalog contains only the three target models.
8. Run the four-second pricing and capability smoke tests.
9. Trigger one controlled upstream failure and verify a refund.

Rollback restores the two configuration table backups and the previous
application release. No historical generation or billing data needs to be
restored because the migration does not modify it.

## Acceptance Criteria

- Only Gemini Omni Flash, Sora V3 Pro, and Veo 3.1 Fast are visible and usable.
- Existing models and routes still exist but are inactive.
- Each active model uses its own configured PixelHub key.
- Model controls and submitted fields exactly match the documented capability
  matrix.
- Sora accepts image and video references but not audio references.
- PixelHub receives public media URLs and no deprecated reference field names.
- Billing is calculated per second and invalid requests are rejected before
  charging.
- Async failure and timeout paths refund the correct reservation.
- Existing video history and billing history remain intact.
