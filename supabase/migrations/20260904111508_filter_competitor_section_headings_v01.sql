create or replace function public.get_competitor_significance_v01(
  p_org_id uuid,
  p_business_id uuid,
  p_run_id uuid
)
returns table(
  canonical_key text,
  name text,
  tier text,
  significance_score integer,
  response_count integer,
  mention_count integer,
  question_count integer,
  intent_count integer,
  top3_response_count integer,
  citation_response_count integer,
  direct_citation_response_count integer,
  compatible_run_count integer,
  compatible_run_presence_count integer,
  prior_run_presence_count integer,
  repeat_response_count integer,
  is_new boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.*
  from public.get_competitor_significance_v02(p_org_id,p_business_id,p_run_id) s
  where regexp_replace(lower(s.name), '\s+', '', 'g') !~
    '(정비소|정비센터|서비스센터|공업사|카센터|카센타|전문점)(추천|추천순위|순위|비교|정리|목록|요약|결론|체크리스트)$';
$function$;
