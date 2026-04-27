# Generated Image Asset Persistence

This feature stores generated images in your own object storage so upstream
temporary image URLs can expire without breaking the canvas or history.

It is off by default. Videos are intentionally not uploaded.

## Enable

Add the storage variables to `.env`, deploy the code, then restart the backend.

```env
GENERATED_ASSET_STORAGE=on
GENERATED_ASSET_PROVIDER=aliyun-oss
GENERATED_ASSET_PUBLIC_BASE_URL=https://img.example.com
GENERATED_ASSET_BUCKET=your_bucket_name
GENERATED_ASSET_PREFIX=generated/images
GENERATED_ASSET_MAX_BYTES=52428800
GENERATED_ASSET_DOWNLOAD_TIMEOUT_MS=30000
GENERATED_ASSET_CACHE_CONTROL=public, max-age=31536000, immutable

ALIYUN_OSS_REGION=oss-cn-hangzhou
ALIYUN_OSS_ENDPOINT=
ALIYUN_OSS_ACCESS_KEY_ID=your_oss_access_key_id
ALIYUN_OSS_ACCESS_KEY_SECRET=your_oss_access_key_secret
```

For Cloudflare R2 or other S3-compatible storage:

```env
GENERATED_ASSET_STORAGE=on
GENERATED_ASSET_PROVIDER=s3-compatible
GENERATED_ASSET_PUBLIC_BASE_URL=https://img.example.com
GENERATED_ASSET_BUCKET=your_bucket_name
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=your_access_key_id
S3_SECRET_ACCESS_KEY=your_secret_access_key
S3_FORCE_PATH_STYLE=false
```

## Rollout

1. Deploy with `GENERATED_ASSET_STORAGE=off`.
2. Confirm normal image and video generation still works.
3. Set `GENERATED_ASSET_STORAGE=on` and restart the backend.
4. Generate one sync image and one async image.
5. Confirm the returned image URL starts with `GENERATED_ASSET_PUBLIC_BASE_URL`.

To roll back, set `GENERATED_ASSET_STORAGE=off` and restart. Generation will
continue to return upstream URLs as before.

## Covered Paths

- `/api/generate` image sync success.
- Visionary-style image background success.
- `/api/task/:taskId` image async success.
- `/api/edit` direct image success.
- `/api/gemini/generate` data-URL compatibility path.

Video endpoints are not persisted.
