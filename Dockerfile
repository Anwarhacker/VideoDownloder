# ---------- 1. Base Stage ----------
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install OS dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    wget

# Install yt-dlp
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Copy dependency files
COPY package*.json ./

# Install dependencies (faster and reproducible)
RUN npm ci --omit=dev

# ---------- 2. Build Stage ----------
FROM base AS build

# Copy source code
COPY . .

# Set build-time environment variable
ARG MONGODB_URI
ENV MONGODB_URI=${MONGODB_URI}

# Build the app
RUN npm run build

# ---------- 3. Production Stage ----------
FROM node:18-alpine AS production

WORKDIR /app

# Copy only necessary runtime files from build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package*.json ./

# Install only production dependencies
RUN npm prune --omit=dev

# Expose the app port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Start the app
CMD ["npm", "start"]
