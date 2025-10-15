# Sandata EVV Service Container
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY src/ ./src/
COPY index.js ./
COPY start.sh ./

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 7015

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:7015/health || exit 1

# Start the service
CMD ["node", "src/sandataService.js"]