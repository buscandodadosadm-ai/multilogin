FROM node:20-bookworm-slim

WORKDIR /app

# Instalar dependências do sistema
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

# Copia package primeiro (cache melhor)
COPY package.json ./
COPY package-lock.json ./

# Instala dependências (inclui Playwright)
RUN npm install

# Agora instala os browsers do Playwright (CORRETO)
RUN npx playwright install --with-deps

# Copia restante do projeto
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
