FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY config ./config
COPY lib ./lib
COPY public ./public
RUN mkdir -p data/audits
ENV PORT=3000 DATA_DIR=/app/data SELENIUM_URL=http://google-browser:4444
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
