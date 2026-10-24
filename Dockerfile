# Build Stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build frontend. .git is excluded from the build context, so the commit is
# passed in: APP_COMMIT=$(git rev-parse --short HEAD) docker compose build app
ARG APP_COMMIT=
RUN node -e "const fs=require('fs');const builtAt=new Date().toISOString();fs.writeFileSync('public/build-id.txt', process.env.APP_BUILD_ID || builtAt + '-' + require('crypto').randomUUID());fs.writeFileSync('public/build-info.json', JSON.stringify({commit:String(process.env.APP_COMMIT||'unknown').slice(0,12),builtAt}))" && npm run build

# Production Stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend runtime files
COPY server.cjs ./
COPY promptToolResponse.cjs ./
COPY imageRequestCount.cjs ./
COPY seedreamImagePolicy.cjs ./
COPY imageModelCompatibility.cjs ./
COPY imageRouteCompatibility.cjs ./
COPY visionaryImageApi.cjs ./
COPY imageRouteResolution.cjs ./
COPY db.cjs ./
COPY imageRouteStore.cjs ./
COPY imageCatalogInitialization.cjs ./
COPY imageModelStore.cjs ./
COPY videoRouteStore.cjs ./
COPY videoModelStore.cjs ./
COPY authStore.cjs ./
COPY authShared.cjs ./
COPY authStore.file.cjs ./
COPY authStore.mysql.cjs ./
COPY billingStore.cjs ./
COPY billingStore.file.cjs ./
COPY billingStore.mysql.cjs ./
COPY billingReportUtils.cjs ./
COPY redeemCodePolicy.cjs ./
COPY pointMath.cjs ./
COPY generatedAssetService.cjs ./
COPY imageJobStore.cjs ./
COPY imageJobService.cjs ./
COPY imageJobAssets.cjs ./
COPY operationsDashboard.cjs ./
COPY operationsDashboardStore.cjs ./
COPY operationsRuntimeMetrics.cjs ./
COPY videoReferenceUpload.cjs ./
COPY videoFrameUpload.cjs ./
COPY videoRequestPolicy.cjs ./
COPY videoTaskUtils.cjs ./
COPY videoReferenceMedia.cjs ./
COPY pixelhubVideoMigration.cjs ./
COPY generationRecordStore.cjs ./
COPY generationRecordStore.file.cjs ./
COPY generationRecordStore.mysql.cjs ./
COPY adminChangeLogStore.cjs ./
COPY config ./config
COPY scripts ./scripts

# Create runtime directories used by announcements/uploads
RUN mkdir -p /app/uploads/announcements /app/uploads/video-references /app/uploads/video-frames /app/storage/image-jobs

# Expose port
EXPOSE 3365

# Start the server
CMD ["node", "server.cjs"]
