# Fase de build
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Instala tudo, incluindo devDependencies
RUN npm ci

COPY . .

# Gera o build
RUN npm run build

# 🏁 Fase final (somente com runtime)
FROM node:18-alpine AS runner

WORKDIR /app

# Copia só o necessário do build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

EXPOSE 9999
CMD ["node", "dist/main.js"]
