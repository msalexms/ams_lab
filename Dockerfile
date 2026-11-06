# [AMS] lab — imagen para el homelab. Node 24 (node:sqlite) + dependencias de npm solo para la IA (AI SDK y zod).
#   docker build -t ams-lab .        (o docker compose up -d --build)
FROM node:24-alpine
RUN apk add --no-cache su-exec
ENV NODE_ENV=production AMS_LAB_DATA=/data PORT=4321
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY scripts ./scripts
COPY seed ./seed
COPY public ./public
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/salud').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.mjs"]
