# Keycloak for hosted staging (Railway): Postgres-backed, built ahead of time, imports the staging realm on first start.
# Runtime variables: KC_DB_URL, KC_DB_USERNAME, KC_DB_PASSWORD, KC_HOSTNAME (public https URL), KC_BOOTSTRAP_ADMIN_*,
# and the realm placeholders HF_CONSOLE_URL, HF_KC_CONSOLE_SECRET, HF_KC_ADMIN_SECRET, HF_KC_STAFF_TEMP_PASSWORD.
FROM keycloak/keycloak:26.2 AS builder
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=false
RUN /opt/keycloak/bin/kc.sh build

FROM keycloak/keycloak:26.2
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY infra/keycloak/realm-healthflow-staging.json /opt/keycloak/data/import/realm-healthflow.json
# TLS ends at the platform's proxy; Keycloak trusts its X-Forwarded-* headers and serves plain HTTP inside.
ENV KC_HTTP_ENABLED=true KC_HTTP_PORT=8080 KC_PROXY_HEADERS=xforwarded
EXPOSE 8080
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
