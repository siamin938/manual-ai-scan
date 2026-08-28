-- Repo/production schema sync for the generic citation attribution table.
-- The table already exists in production; every statement is idempotent.

CREATE TABLE IF NOT EXISTS public.measurement_citation_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_run_id uuid NOT NULL REFERENCES public.measurement_runs(id) ON DELETE CASCADE,
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  measurement_mention_id uuid REFERENCES public.measurement_mentions(id) ON DELETE SET NULL,
  canonical_key text NOT NULL,
  canonical_display_name text NOT NULL,
  citation_url text NOT NULL,
  domain text,
  title text,
  citation_start_index integer NOT NULL,
  citation_end_index integer NOT NULL,
  entity_start_index integer,
  entity_end_index integer,
  attribution_level text NOT NULL CHECK (attribution_level IN ('direct', 'section')),
  attribution_version text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS measurement_citation_attribut_measurement_id_canonical_key__key
  ON public.measurement_citation_attributions
  (measurement_id, canonical_key, citation_url, citation_start_index, attribution_version);

CREATE INDEX IF NOT EXISTS measurement_citation_attributions_scope_idx
  ON public.measurement_citation_attributions
  (org_id, business_id, source_run_id, attribution_version, canonical_key);

CREATE INDEX IF NOT EXISTS measurement_citation_attributions_measurement_idx
  ON public.measurement_citation_attributions (measurement_id);

CREATE INDEX IF NOT EXISTS measurement_citation_attributions_domain_idx
  ON public.measurement_citation_attributions (domain);

GRANT SELECT ON public.measurement_citation_attributions TO authenticated;
GRANT ALL ON public.measurement_citation_attributions TO service_role;

ALTER TABLE public.measurement_citation_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS citation_attributions_select_org_members ON public.measurement_citation_attributions;
CREATE POLICY citation_attributions_select_org_members
  ON public.measurement_citation_attributions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.org_id = measurement_citation_attributions.org_id
      AND om.user_id = auth.uid()
  ));
