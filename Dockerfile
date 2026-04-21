FROM node:20-bookworm-slim

WORKDIR /app

# Instala tudo necessário para browser + VNC
RUN apt-get update && apt-get install -y \
    chromium \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    fluxbox \
    wget \
    curl \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV DISPLAY=:99

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
