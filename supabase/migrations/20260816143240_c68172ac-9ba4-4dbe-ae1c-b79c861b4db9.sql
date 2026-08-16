UPDATE public.businesses
SET aliases = (
  SELECT array_agg(DISTINCT a)
  FROM unnest(aliases || ARRAY['판교정비센타','판교 정비센타','판교정비 센터']) AS a
),
updated_at = now()
WHERE id = 'bba3af89-c1fa-4fd0-8879-8307f4106b5e';