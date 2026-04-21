# Imagem oficial do Playwright (já vem com Chromium + dependências)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Diretório da aplicação
WORKDIR /app

# Copia apenas arquivos de dependência primeiro (cache eficiente)
COPY package.json package-lock.json ./

# Instala dependências do Node
RUN npm install --omit=dev

# Copia restante do projeto
COPY . .

# Variáveis recomendadas
ENV NODE_ENV=production
ENV PORT=3000

# Expõe porta
EXPOSE 3000

# Inicia servidor
CMD ["node", "server.js"]
