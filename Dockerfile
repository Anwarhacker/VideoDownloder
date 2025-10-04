FROM node:18-alpine

# Install yt-dlp and ffmpeg
RUN apk add --no-cache \
    yt-dlp \
    ffmpeg \
    python3 \
    py3-pip

# Install yt-dlp Python dependencies if needed
RUN pip3 install --break-system-packages yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy environment file for build
COPY .env.local ./

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]