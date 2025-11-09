# ---------- 1. Base Stage ----------
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install OS dependencies + yt-dlp
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    wget && \
    wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

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

# Build the app (for Next.js or any build step)
RUN npm run build || echo "No build step found"

# ---------- 3. Production Stage ----------
FROM node:18-alpine AS production

WORKDIR /app

# Install runtime dependencies + yt-dlp in production stage
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    wget && \
    wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

# Copy app files from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public

# Expose the port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Start the app
CMD ["npm", "start"]
