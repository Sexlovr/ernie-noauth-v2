# ── Build stage: clone and compile better-sqlite3 native addon ──
FROM node:20-bullseye AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone your updated repository
RUN git clone https://github.com/Sexlovr/ernie-2-api-noauth-.git .

# Install dependencies
RUN npm install --omit=dev

# ── Runtime stage: Screenshot Clicker Ready ──
FROM node:20-bullseye

# Install virtual framebuffer (Xvfb) and basic required tools
RUN apt-get update && apt-get install -y \
    xvfb \
    dos2unix \
    curl \
    wget \
    gnupg \
    procps \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data
RUN chown -R 1000:1000 /data

WORKDIR /app
COPY --from=builder --chown=1000:1000 /app ./

# Install Playwright dependencies AS ROOT
RUN npx playwright install-deps chromium

USER 1000

# Install Chromium binary AS NODE USER
RUN npx playwright install chromium

ENV PORT=7860
ENV DATA_DIR=/data

EXPOSE 7860

CMD ["node", "index.js"]
