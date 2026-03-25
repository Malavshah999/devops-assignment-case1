FROM node:20-alpine

# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000
CMD ["node", "index.js"]