# Gunakan base image resmi Node.js 22 Slim (Debian)
FROM node:22-slim

WORKDIR /app

# Pasang dependensi kompilasi untuk native bindings better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Salin package manifest
COPY package*.json ./

# Pasang dependensi produksi
RUN npm ci --omit=dev

# Salin seluruh kode aplikasi
COPY . .

# Siapkan folder data untuk persistent volume
RUN mkdir -p data

VOLUME ["/app/data"]

ENV NODE_ENV=production

# Port untuk endpoint health check dan/atau webhook Telegram
EXPOSE 3000

CMD ["node", "src/index.js"]

