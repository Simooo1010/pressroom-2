# Base image ships Chrome for Puppeteer 23.11.1 (matches package-lock) in
# /home/pptruser/.cache/puppeteer plus all system libs and fonts; it has NO
# /usr/bin/google-chrome-stable, so don't point PUPPETEER_EXECUTABLE_PATH there.
FROM ghcr.io/puppeteer/puppeteer:23.11.1

# tini as PID 1: reaps Chrome's orphaned child processes and forwards SIGTERM.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app && chown pptruser:pptruser /app

# Run as the image's unprivileged user (Chrome runs with --no-sandbox, so keep it non-root).
USER pptruser
WORKDIR /app
# Reuse the browser already in the image; if the lockfile's puppeteer ever
# changes version, `npm ci` downloads the matching Chrome into the same cache.
ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer

COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci
COPY --chown=pptruser:pptruser . .
RUN npm run build \
 && npm prune --omit=dev \
 && node -e "const p=require('puppeteer').executablePath();require('fs').accessSync(p);console.log('Chrome:',p)"

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
