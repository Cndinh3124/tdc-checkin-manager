# Image backend - dac ta 8.5: pin phien ban, chay user khong phai root
# Build tu thu muc goc repo:  docker build -f apps/api/Dockerfile -t tdc-qr-api .
FROM node:26.13.1-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci
COPY apps/api apps/api
RUN npm run -w apps/api build

FROM node:26.13.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# chi cai thu vien chay that, khong co cong cu dev
RUN npm ci --omit=dev && npm cache clean --force \
    # [BM] go npm/npx/corepack khoi image chay: container chi can `node`, con cac goi di kem npm
    # (pacote, sigstore, brace-expansion...) la ngoai ung dung va hay co CVE. Thu nho be mat tan cong.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
              /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm /tmp/*
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/assets apps/api/assets
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
