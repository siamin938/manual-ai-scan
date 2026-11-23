-- Sync customer-declared public business URLs into the verified first-party registry.
--
-- Safety contract:
-- - Existing registry rows are treated as manual and are never edited/deleted here.
-- - Only rows managed_by='business_profile' are created/updated/deactivated.
-- - Shared platform hosts are never promoted to owned_domain at host scope.
-- - Naver Blog and Naver Place use their narrower existing match modes.
-- - Invalid/unsupported URLs fail closed by leaving no active auto-managed row.
-- - This registry is advisory source identity only; it does not change AI visibility truth.

ALTER TABLE public.business_first_party_sources
  ADD COLUMN IF NOT EXISTS managed_by text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.business_first_party_sources'::regclass
      AND conname = 'business_first_party_sources_managed_by_chk'
  ) THEN
    ALTER TABLE public.business_first_party_sources
      ADD CONSTRAINT business_first_party_sources_managed_by_chk
      CHECK (managed_by IN ('manual', 'business_profile'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS business_first_party_sources_profile_slot_uq
  ON public.business_first_party_sources (org_id, business_id, source_type)
  WHERE managed_by = 'business_profile';

CREATE OR REPLACE FUNCTION public.business_profile_url_host_v01(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_authority text;
  v_host text;
BEGIN
  IF p_url IS NULL OR btrim(p_url) = '' THEN
    RETURN NULL;
  END IF;
  IF btrim(p_url) !~* '^https?://' THEN
    RETURN NULL;
  END IF;

  v_authority := substring(
    btrim(p_url)
    FROM '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)'
  );
  IF v_authority IS NULL OR position('@' IN v_authority) > 0 THEN
    RETURN NULL;
  END IF;

  -- This registry intentionally accepts DNS hostnames only.
  IF v_authority LIKE '[%' THEN
    RETURN NULL;
  END IF;

  v_host := lower(split_part(v_authority, ':', 1));
  v_host := regexp_replace(v_host, '^www\.', '', 'i');
  v_host := regexp_replace(v_host, '\.$', '');

  IF v_host = ''
     OR v_host = 'localhost'
     OR position('.' IN v_host) = 0
     OR v_host ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
  THEN
    RETURN NULL;
  END IF;

  RETURN v_host;
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_profile_naver_blog_key_v01(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_host text;
  v_key text;
BEGIN
  v_host := public.business_profile_url_host_v01(p_url);
  IF v_host NOT IN ('blog.naver.com', 'm.blog.naver.com') THEN
    RETURN NULL;
  END IF;

  v_key := substring(
    btrim(p_url)
    FROM '^https?://[^/?#]+/([^/?#]+)'
  );
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RETURN NULL;
  END IF;

  -- Generic Naver endpoint paths do not identify one business blog.
  IF lower(v_key) IN (
    'postview.naver',
    'postlist.naver',
    'blogprofile.naver'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN lower(btrim(v_key));
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_profile_is_shared_host_v01(p_host text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT coalesce(lower(btrim(p_host)), '') = ANY (ARRAY[
    'blog.naver.com',
    'm.blog.naver.com',
    'naver.me',
    'place.naver.com',
    'm.place.naver.com',
    'map.naver.com',
    'm.map.naver.com',
    'instagram.com',
    'facebook.com',
    'youtube.com',
    'youtu.be',
    'pf.kakao.com',
    'open.kakao.com',
    'daangn.com',
    'karrotmarket.com',
    'mycle.co.kr',
    'tistory.com',
    'notion.site'
  ]::text[]);
$function$;

CREATE OR REPLACE FUNCTION public.business_profile_naver_place_url_v01(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
DECLARE
  v_host text;
  v_url text;
BEGIN
  v_host := public.business_profile_url_host_v01(p_url);
  IF v_host NOT IN (
    'naver.me',
    'place.naver.com',
    'm.place.naver.com',
    'map.naver.com',
    'm.map.naver.com'
  ) THEN
    RETURN NULL;
  END IF;

  v_url := split_part(btrim(p_url), '#', 1);
  IF v_url = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_url;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_business_profile_first_party_sources_v01(
  p_business_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business record;
  v_website_url text;
  v_website_host text;
  v_blog_key text;
  v_place_url text;
  v_place_host text;
  v_auto_id uuid;
BEGIN
  SELECT
    b.id,
    b.org_id,
    b.active,
    b.website_url,
    b.naver_place_url
  INTO v_business
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Auto-managed rows follow the active lifecycle of the business.
  IF NOT v_business.active THEN
    UPDATE public.business_first_party_sources
    SET active = false
    WHERE business_id = v_business.id
      AND org_id = v_business.org_id
      AND managed_by = 'business_profile'
      AND active = true;
    RETURN;
  END IF;

  v_website_url := CASE
    WHEN v_business.website_url IS NULL OR btrim(v_business.website_url) = ''
      THEN NULL
    ELSE split_part(btrim(v_business.website_url), '#', 1)
  END;
  v_website_host := public.business_profile_url_host_v01(v_website_url);
  v_blog_key := public.business_profile_naver_blog_key_v01(v_website_url);

  -- Website slot: Naver Blog receives resource-level matching.
  IF v_blog_key IS NOT NULL THEN
    UPDATE public.business_first_party_sources
    SET active = false
    WHERE org_id = v_business.org_id
      AND business_id = v_business.id
      AND managed_by = 'business_profile'
      AND source_type = 'owned_domain'
      AND active = true;

    IF EXISTS (
      SELECT 1
      FROM public.business_first_party_sources s
      WHERE s.org_id = v_business.org_id
        AND s.business_id = v_business.id
        AND s.managed_by = 'manual'
        AND s.source_type = 'naver_blog'
        AND s.active = true
        AND lower(s.resource_key) = v_blog_key
    ) THEN
      UPDATE public.business_first_party_sources
      SET active = false
      WHERE org_id = v_business.org_id
        AND business_id = v_business.id
        AND managed_by = 'business_profile'
        AND source_type = 'naver_blog'
        AND active = true;
    ELSE
      SELECT s.id INTO v_auto_id
      FROM public.business_first_party_sources s
      WHERE s.org_id = v_business.org_id
        AND s.business_id = v_business.id
        AND s.managed_by = 'business_profile'
        AND s.source_type = 'naver_blog'
      LIMIT 1;

      IF v_auto_id IS NULL THEN
        INSERT INTO public.business_first_party_sources (
          org_id,
          business_id,
          source_type,
          canonical_url,
          normalized_host,
          resource_key,
          match_mode,
          verification_status,
          active,
          managed_by
        ) VALUES (
          v_business.org_id,
          v_business.id,
          'naver_blog',
          'https://blog.naver.com/' || v_blog_key,
          'blog.naver.com',
          v_blog_key,
          'resource_prefix',
          'verified',
          true,
          'business_profile'
        );
      ELSE
        UPDATE public.business_first_party_sources
        SET canonical_url = 'https://blog.naver.com/' || v_blog_key,
            normalized_host = 'blog.naver.com',
            resource_key = v_blog_key,
            match_mode = 'resource_prefix',
            verification_status = 'verified',
            active = true
        WHERE id = v_auto_id;
      END IF;
    END IF;
  ELSE
    UPDATE public.business_first_party_sources
    SET active = false
    WHERE org_id = v_business.org_id
      AND business_id = v_business.id
      AND managed_by = 'business_profile'
      AND source_type = 'naver_blog'
      AND active = true;

    IF v_website_host IS NOT NULL
       AND NOT public.business_profile_is_shared_host_v01(v_website_host)
    THEN
      IF EXISTS (
        SELECT 1
        FROM public.business_first_party_sources s
        WHERE s.org_id = v_business.org_id
          AND s.business_id = v_business.id
          AND s.managed_by = 'manual'
          AND s.source_type = 'owned_domain'
          AND s.active = true
          AND lower(s.normalized_host) = v_website_host
      ) THEN
        UPDATE public.business_first_party_sources
        SET active = false
        WHERE org_id = v_business.org_id
          AND business_id = v_business.id
          AND managed_by = 'business_profile'
          AND source_type = 'owned_domain'
          AND active = true;
      ELSE
        v_auto_id := NULL;
        SELECT s.id INTO v_auto_id
        FROM public.business_first_party_sources s
        WHERE s.org_id = v_business.org_id
          AND s.business_id = v_business.id
          AND s.managed_by = 'business_profile'
          AND s.source_type = 'owned_domain'
        LIMIT 1;

        IF v_auto_id IS NULL THEN
          INSERT INTO public.business_first_party_sources (
            org_id,
            business_id,
            source_type,
            canonical_url,
            normalized_host,
            resource_key,
            match_mode,
            verification_status,
            active,
            managed_by
          ) VALUES (
            v_business.org_id,
            v_business.id,
            'owned_domain',
            v_website_url,
            v_website_host,
            NULL,
            'host_or_subdomain',
            'verified',
            true,
            'business_profile'
          );
        ELSE
          UPDATE public.business_first_party_sources
          SET canonical_url = v_website_url,
              normalized_host = v_website_host,
              resource_key = NULL,
              match_mode = 'host_or_subdomain',
              verification_status = 'verified',
              active = true
          WHERE id = v_auto_id;
        END IF;
      END IF;
    ELSE
      UPDATE public.business_first_party_sources
      SET active = false
      WHERE org_id = v_business.org_id
        AND business_id = v_business.id
        AND managed_by = 'business_profile'
        AND source_type = 'owned_domain'
        AND active = true;
    END IF;
  END IF;

  -- Naver Place slot: exact resource matching only.
  v_place_url := public.business_profile_naver_place_url_v01(
    v_business.naver_place_url
  );
  v_place_host := public.business_profile_url_host_v01(v_place_url);

  IF v_place_url IS NULL THEN
    UPDATE public.business_first_party_sources
    SET active = false
    WHERE org_id = v_business.org_id
      AND business_id = v_business.id
      AND managed_by = 'business_profile'
      AND source_type = 'naver_place'
      AND active = true;
  ELSIF EXISTS (
    SELECT 1
    FROM public.business_first_party_sources s
    WHERE s.org_id = v_business.org_id
      AND s.business_id = v_business.id
      AND s.managed_by = 'manual'
      AND s.source_type = 'naver_place'
      AND s.active = true
      AND s.canonical_url = v_place_url
  ) THEN
    UPDATE public.business_first_party_sources
    SET active = false
    WHERE org_id = v_business.org_id
      AND business_id = v_business.id
      AND managed_by = 'business_profile'
      AND source_type = 'naver_place'
      AND active = true;
  ELSE
    v_auto_id := NULL;
    SELECT s.id INTO v_auto_id
    FROM public.business_first_party_sources s
    WHERE s.org_id = v_business.org_id
      AND s.business_id = v_business.id
      AND s.managed_by = 'business_profile'
      AND s.source_type = 'naver_place'
    LIMIT 1;

    IF v_auto_id IS NULL THEN
      INSERT INTO public.business_first_party_sources (
        org_id,
        business_id,
        source_type,
        canonical_url,
        normalized_host,
        resource_key,
        match_mode,
        verification_status,
        active,
        managed_by
      ) VALUES (
        v_business.org_id,
        v_business.id,
        'naver_place',
        v_place_url,
        v_place_host,
        NULL,
        'exact_url',
        'verified',
        true,
        'business_profile'
      );
    ELSE
      UPDATE public.business_first_party_sources
      SET canonical_url = v_place_url,
          normalized_host = v_place_host,
          resource_key = NULL,
          match_mode = 'exact_url',
          verification_status = 'verified',
          active = true
      WHERE id = v_auto_id;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_business_profile_first_party_sources_trg_v01()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.sync_business_profile_first_party_sources_v01(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS businesses_sync_first_party_profile_v01
  ON public.businesses;

CREATE TRIGGER businesses_sync_first_party_profile_v01
AFTER INSERT OR UPDATE OF website_url, naver_place_url, active, org_id
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.sync_business_profile_first_party_sources_trg_v01();

REVOKE ALL ON FUNCTION public.sync_business_profile_first_party_sources_v01(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_business_profile_first_party_sources_v01(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.sync_business_profile_first_party_sources_trg_v01()
  FROM PUBLIC, anon, authenticated;

-- Generic backfill: no business-specific ids. Existing manual rows are preserved.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT b.id
    FROM public.businesses b
    WHERE b.active = true
      AND (
        (b.website_url IS NOT NULL AND btrim(b.website_url) <> '')
        OR
        (b.naver_place_url IS NOT NULL AND btrim(b.naver_place_url) <> '')
      )
  LOOP
    PERFORM public.sync_business_profile_first_party_sources_v01(r.id);
  END LOOP;
END
$$;
