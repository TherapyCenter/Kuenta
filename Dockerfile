# Kuenta as a container image (Docker and Podman)
#
#   podman build -t kuenta:1.0.7 .        (or: docker build -t kuenta:1.0.7 .)
#   podman run -d --name kuenta -p 3700:3700 -v kuenta-daten:/data kuenta:1.0.7
#
# Runs on x86_64 and ARM64 (e.g. Raspberry Pi, Mac with Apple silicon).
# Data lives in the volume /data – never in the image. Details: INSTALL.md, section "Container".
ARG NODE_VERSION=24.21.0
FROM docker.io/library/node:${NODE_VERSION}-bookworm-slim

# time zone data so invoice date and time are right (default: Europe/Berlin, change via TZ)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3700 \
    KUENTA_DATA=/data \
    KUENTA_CONTAINER=1 \
    TZ=Europe/Berlin

WORKDIR /app
# Kuenta needs no npm packages – only its own files
COPY package.json README.md README.de.md INSTALL.md LICENSE PRO.md ./
COPY server ./server
COPY public ./public

# run without root rights (the Node image ships the user "node", UID 1000)
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME ["/data"]
EXPOSE 3700

# health check (Podman only evaluates it with "podman build --format docker")
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3700)+'/api/session').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/index.js"]

LABEL org.opencontainers.image.title="Kuenta" \
      org.opencontainers.image.description="Invoicing & POS for auto repair shops" \
      org.opencontainers.image.version="1.0.7"
