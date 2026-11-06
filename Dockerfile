FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY seed ./seed
ENV AMS_LAB_DATA=/data PORT=4321
VOLUME /data
EXPOSE 4321
CMD ["node", "server/index.mjs"]
