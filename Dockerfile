FROM node:20-bookworm-slim

WORKDIR /app

# Instalar dependências do Playwright
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libgtk-3-0 \
    libxshmfence1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Instalar browsers do Playwright
RUN npx playwright install --with-deps

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
