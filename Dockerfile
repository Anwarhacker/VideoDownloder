FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    wget

# Install the latest version of yt-dlp
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Set a dummy MONGODB_URI for build-time
ARG MONGODB_URI="mongodb://dummy-uri"
ENV MONGODB_URI=$MONGODB_URI

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
