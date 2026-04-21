FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

# Instala xvfb (display virtual) + libs extras
RUN apt-get update && apt-get install -y \
    xvfb \
    dbus \
    dbus-x11 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Evita erro de DBus
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null

# Copia dependências
COPY package.json package-lock.json ./

RUN npm install --omit=dev

# Copia projeto
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# 🔥 roda com display virtual (resolve seu erro)
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x720x24", "node", "server.js"]
