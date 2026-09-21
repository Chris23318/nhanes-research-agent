FROM node:24-bookworm-slim AS runtime

ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
    r-base-core r-cran-haven r-cran-survey r-cran-jsonlite r-cran-dplyr r-cran-purrr r-cran-tibble r-cran-mice r-cran-mitools fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*
RUN Rscript -e "stopifnot(requireNamespace('survey', quietly=TRUE), requireNamespace('mice', quietly=TRUE), requireNamespace('mitools', quietly=TRUE))"

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.js app.js index.html styles.css ./
COPY --chown=node:node src ./src
COPY --chown=node:node runner ./runner
COPY --chown=node:node scripts ./scripts
RUN node scripts/validate-generated-model.js | Rscript -e 'parse(file("stdin"))'
RUN Rscript scripts/validate-mi-runtime.R

USER node
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
