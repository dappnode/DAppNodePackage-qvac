FROM node:22-bookworm-slim

ARG UPSTREAM_VERSION
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates ffmpeg libatomic1 libvulkan1 mesa-vulkan-drivers tini \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --no-audit --no-fund "@qvac/cli@${UPSTREAM_VERSION}" \
    && chmod 0755 /usr/local/lib/node_modules/@qvac/cli/node_modules/bare-runtime-*/bin/bare \
    && case "${TARGETARCH}" in \
        amd64) qvac_platform=linux-x64 ;; \
        arm64) qvac_platform=linux-arm64 ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && export qvac_platform \
    && find /usr/local/lib/node_modules/@qvac/cli/node_modules -type d -name prebuilds \
       | while IFS= read -r qvac_prebuilds; do \
           find "${qvac_prebuilds}" -mindepth 1 -maxdepth 1 -type d \
             ! -name "${qvac_platform}" ! -name include ! -name share -exec rm -rf {} +; \
         done \
    && npm cache clean --force

WORKDIR /app

COPY qvac.config.mjs /app/qvac.config.mjs
COPY manager.mjs /app/manager.mjs
COPY ui /app/ui
COPY avatar.png /app/ui/avatar.png

RUN mkdir -p /data/config /data/models /data/runtime \
    && chown -R node:node /app /data

ENV HOME=/data \
    NODE_ENV=production \
    QVAC_VERSION=${UPSTREAM_VERSION}

USER node

EXPOSE 8080 11434

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/manager.mjs"]
