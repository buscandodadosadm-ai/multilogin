FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    chromium \
    x11vnc \
    xvfb \
    novnc \
    websockify \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json ./
RUN npm install

COPY server.js ./

EXPOSE 3000

CMD ["node", "server.js"]
