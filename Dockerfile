# Imagem oficial do Playwright com todas as dependências
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

# Instala o dumb-init para gerenciar os processos do Chromium corretamente
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Diretório da aplicação
WORKDIR /app

# Copia dependências
COPY package.json ./
RUN npm install --omit=dev

# Copia o código
COPY . .

# Cria a pasta de perfis e ajusta permissões para o usuário seguro 'pwuser'
RUN mkdir -p /app/profiles && chown -R pwuser:pwuser /app

# Usa o usuário não-root por segurança
USER pwuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Inicia com o dumb-init para evitar leaks de memória
CMD ["dumb-init", "node", "server.js"]
