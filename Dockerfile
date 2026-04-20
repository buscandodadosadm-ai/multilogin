# Usar imagem oficial do Playwright que já tem Chromium + dependências
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Instalar noVNC, x11vnc, xvfb, websockify
RUN apt-get update && apt-get install -y \
    x11vnc \
    xvfb \
    novnc \
    websockify \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
