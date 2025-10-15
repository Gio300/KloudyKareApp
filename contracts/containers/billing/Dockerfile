FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

RUN addgroup -g 1001 -S contractuser && \
    adduser -S contractuser -u 1001
RUN chown -R contractuser:contractuser /app

USER contractuser

EXPOSE 8080

CMD ["node", "index.js"]
