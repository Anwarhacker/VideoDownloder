# ---------- 1. Base Stage ----------
FROM node:18-alpine AS base

WORKDIR /app

# Install system dependencies + yt-dlp
RUN apk add --no-cache ffmpeg python3 wget && \
    wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -O /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

# Copy dependency files
COPY package*.json ./

# Install dependencies (omit dev for smaller image)
RUN npm ci --omit=dev

# ---------- 2. Build Stage ----------
FROM base AS build

# Copy full source code
COPY . .

# Set build-time environment variable
ARG MONGODB_URI
ENV MONGODB_URI=${MONGODB_URI}

# Build app (Next.js)
RUN npm run build || echo "No build step found"

# ---------- 3. Production Stage ----------
FROM node:18-alpine AS production

WORKDIR /app

# Install runtime dependencies + yt-dlp
RUN apk add --no-cache ffmpeg python3 wget && \
    wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -O /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

# Copy only what exists
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/.next ./.next

# Optional: copy public folder only if exists
COPY --from=build /app/public ./public || echo "No public folder, skipping"

# Expose port
EXPOSE 3000
ENV NODE_ENV=production

# Start the app
CMD ["npm", "start"]
