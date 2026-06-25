# Browser-free noauth proxy — plain Node, no Xvfb / Chromium / native addons.
FROM node:22-slim

WORKDIR /app

# install deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=7860
EXPOSE 7860

# Proxies are supplied at runtime via the PROXIES env var or a mounted proxies.txt.
CMD ["node", "index.js"]
