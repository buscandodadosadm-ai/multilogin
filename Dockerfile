FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

# Instala apenas o necessário para display virtual
RUN apt-get update && apt-get install -y \
    xvfb \
    dumb-init \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Copia dependências
COPY package.json package-lock.json ./

RUN npm install --omit=dev

# Copia o projeto
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# IMPORTANTE: usar dumb-init evita travamentos de processo
ENTRYPOINT ["dumb-init", "--"]

# xvfb apenas quando o servidor já estiver pronto
CMD xvfb-run --auto-servernum --server-args='-screen 0 1280x720x24' node server.js
