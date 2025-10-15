FROM node:20-bullseye-slim

WORKDIR /app

# Install system dependencies required for native modules (e.g., sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --only=production && npm rebuild sqlite3 --build-from-source

# Copy application code
COPY . .

# Create uploads directory
RUN mkdir -p uploads logs data

# Create non-root user (Debian syntax)
RUN addgroup --gid 1001 apiuser && \
    useradd -m -u 1001 -g 1001 apiuser

# Set ownership
RUN chown -R apiuser:apiuser /app

USER apiuser

EXPOSE 7010 7110 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node healthcheck.js

CMD ["node", "index.js"]
