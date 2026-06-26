# Build Stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build frontend
RUN npm run build

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
COPY db.cjs ./
COPY imageRouteStore.cjs ./
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
COPY pointMath.cjs ./
COPY generatedAssetService.cjs ./
COPY generationRecordStore.cjs ./
COPY generationRecordStore.file.cjs ./
COPY generationRecordStore.mysql.cjs ./
COPY adminChangeLogStore.cjs ./
COPY config ./config
COPY scripts ./scripts

# Create runtime directories used by announcements/uploads
RUN mkdir -p /app/uploads/announcements

# Expose port
EXPOSE 3365

# Start the server
CMD ["node", "server.cjs"]
