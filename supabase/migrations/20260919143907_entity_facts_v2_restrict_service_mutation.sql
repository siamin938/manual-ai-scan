-- Supabase default privileges may grant service_role broader table mutation rights
-- on newly created tables. Keep Entity Facts v2 materializations append-only.
REVOKE UPDATE, DELETE ON TABLE public.measurement_entity_facts_v2 FROM service_role;
REVOKE UPDATE, DELETE ON TABLE public.run_entity_fact_aggregates_v2 FROM service_role;
