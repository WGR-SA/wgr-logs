# Build from monorepo root:
#   docker build -t wgr-logs-shipper -f apps/wgr-logs-shipper/Dockerfile .

FROM grafana/alloy:v1.5.1

USER root

# bash + jq + curl are required by the entrypoint.
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash jq curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Shared Alloy module templates from packages/alloy-modules
COPY packages/alloy-modules/*.alloy /opt/wgr-logs-shipper/modules/

# Shipper-specific scripts
COPY apps/wgr-logs-shipper/lib/ /opt/wgr-logs-shipper/lib/
COPY apps/wgr-logs-shipper/entrypoint.sh /opt/wgr-logs-shipper/entrypoint.sh

RUN chmod +x /opt/wgr-logs-shipper/entrypoint.sh /opt/wgr-logs-shipper/lib/*.sh

# Defaults overridable at runtime
ENV WGR_INGEST_URL=https://<INGEST_DOMAIN>/loki/api/v1/push \
    WGR_INGEST_USER=wgr \
    WGR_CONFIG_PATH=/config/sources.json \
    WGR_RENDERED_PATH=/tmp/config.alloy

VOLUME ["/config"]

ENTRYPOINT ["/opt/wgr-logs-shipper/entrypoint.sh"]
CMD []
