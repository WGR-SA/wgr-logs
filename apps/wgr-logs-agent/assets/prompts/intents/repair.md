Réparer un problème ciblé (`--issue`). Diagnostique d'abord, propose, puis applique après confirmation (mutations gated).

Issues supportées :
- **stale-offsets** : offsets corrompus/figés → reset des offsets côté shipper, puis re-trigger.
- **disabled-agent** : agent `disabled` côté API → `PUT /mgmt/agents/:id` `status:active` (gated).
- **rotate-cron-token** (php-mutu) : régénère `.cron-token` (`secret_create`), met à jour le cron URL, invalide l'ancien.
- **429-rate-limit** : push throttlé → réduire la fréquence/volume, espacer le cron, vérifier le backoff.
- **grpc-msg-too-large** : push > limite gRPC → proposer de bumper `loki-config.yaml` (`grpc_server_max_recv_msg_size`) + redéployer, et/ou réduire la taille de batch côté shipper.

Toujours : 1) confirmer la présence de l'issue (diagnose ciblé), 2) annoncer le fix exact, 3) appliquer après confirmation, 4) vérifier (push OK / host de nouveau dans Loki), 5) rapporter.
