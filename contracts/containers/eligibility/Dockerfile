FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S contractuser && \
    adduser -S contractuser -u 1001

# Set ownership
RUN chown -R contractuser:contractuser /app

USER contractuser

EXPOSE 8080

CMD ["node", "index.js"]
