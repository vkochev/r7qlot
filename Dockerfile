FROM node:22-alpine

WORKDIR /app

COPY dist ./dist
COPY config.json ./config.json
COPY package.json ./package.json

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/src/server.js"]
