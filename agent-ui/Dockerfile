FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S uiuser && \
    adduser -S uiuser -u 1001 && \
    chown -R uiuser:uiuser /app

USER uiuser

EXPOSE 8717

# Start the integrated server
CMD ["node", "integrated-server.js"]
