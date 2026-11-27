FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8890 \
    BIND_HOST=0.0.0.0 \
    DATA_DIR=/data \
    MODEL_PROVIDER=deepseek

COPY . .

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 8890

CMD ["node", "server.js"]
