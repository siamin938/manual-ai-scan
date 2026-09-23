-- Phase 2D hardening: complete the append-only contract for Entity Facts v2.
-- Repository-only until Production DDL is explicitly approved.
--
-- UPDATE/DELETE were already revoked in the previous hardening migration.
-- TRUNCATE bypasses row-level immutability triggers, so it must be revoked too.

REVOKE TRUNCATE ON TABLE public.measurement_entity_facts_v2 FROM service_role;
REVOKE TRUNCATE ON TABLE public.run_entity_fact_aggregates_v2 FROM service_role;
