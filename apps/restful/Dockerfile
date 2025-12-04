FROM node:22-slim

# Install necessary dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY dist/package.json ./

# Install production dependencies
RUN npm install --production

# Copy built application
COPY dist/ ./

# Create directories for data persistence
RUN mkdir -p /data/downloads /data/logs

# Environment variables
ENV NODE_ENV=production
ENV PORT=8898
ENV STORAGE_PATH=/data/downloads
ENV LOG_DIR=/data/logs

# Expose port
EXPOSE 8898

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8898/api/health || exit 1

# Start application
CMD ["node", "index.cjs"]
