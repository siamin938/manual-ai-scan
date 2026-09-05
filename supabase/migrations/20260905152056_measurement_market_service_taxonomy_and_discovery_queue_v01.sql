create table if not exists public.measurement_market_service_taxonomy (
  service_key text primary key,
  label text not null,
  pattern text not null,
  is_broad boolean not null default false,
  sort_order integer not null,
  question_anchors text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.measurement_market_service_taxonomy enable row level security;
revoke all on table public.measurement_market_service_taxonomy from anon, authenticated;
grant select, insert, update, delete on table public.measurement_market_service_taxonomy to service_role;

insert into public.measurement_market_service_taxonomy(service_key,label,pattern,is_broad,sort_order,question_anchors)
values
('engine_oil','엔진오일 교환','(엔진\s*오일|엔진오일|오일\s*교환)',false,10,array['엔진오일','오일교환','오일 교환']),
('premium_lubricant','프리미엄 윤활유·합성유','(프리미엄\s*윤활유|윤활유|합성유|\mPAO\M)',false,20,array['윤활유','합성유','프리미엄 오일','프리미엄오일','프리미엄 엔진오일','프리미엄엔진오일','합성 엔진오일','합성엔진오일']),
('tire','타이어','타이어',false,30,array['타이어']),
('wheel','휠','(^|[^가-힣])휠([^가-힣]|$)',false,40,array['휠']),
('tinting','썬팅·틴팅','(썬팅|틴팅)',false,50,array['썬팅','틴팅']),
('new_car_package','신차패키지','(신차\s*패키지|신차패키지)',false,60,array['신차패키지','신차 패키지']),
('ppf','PPF','(\mPPF\M|페인트\s*프로텍션)',false,70,array['PPF','페인트 프로텍션']),
('wrapping','랩핑·래핑','(랩핑|래핑|wrapping)',false,80,array['랩핑','래핑']),
('tuning','튜닝','튜닝',false,90,array['튜닝']),
('electrical','자동차 전장','(전장|블랙박스|하이패스|카오디오|보조\s*배터리)',false,100,array['전장','블랙박스','하이패스','카오디오','보조배터리']),
('vehicle_coding','자동차 코딩·기능 활성화','(자동차\s*코딩|차량\s*코딩|옵션\s*코딩|기능\s*활성화|ECU\s*코딩|코딩\s*전문)',false,105,array['자동차 코딩','차량 코딩','옵션 코딩','기능 활성화','ECU 코딩','코딩']),
('detailing','디테일링','디테일링',false,110,array['디테일링']),
('car_wash','세차','세차',false,120,array['세차']),
('coating','자동차 코팅','(유리막|세라믹\s*코팅|자동차\s*코팅)',false,130,array['코팅','유리막','세라믹']),
('dent','덴트','덴트',false,140,array['덴트']),
('battery','배터리','배터리',false,150,array['배터리']),
('brake','브레이크','브레이크',false,160,array['브레이크']),
('suspension','서스펜션·쇼바','(서스펜션|쇼바)',false,170,array['서스펜션','쇼바']),
('rent_car','렌터카','(렌터카|렌트카)',false,180,array['렌터카','렌트카']),
('general_repair','자동차 일반 정비','(자동차\s*정비|경정비|정비소|카센터|공업사)',true,900,array['정비','카센터','카센타','공업사'])
on conflict(service_key) do update set
 label=excluded.label,
 pattern=excluded.pattern,
 is_broad=excluded.is_broad,
 sort_order=excluded.sort_order,
 question_anchors=excluded.question_anchors,
 active=true,
 updated_at=now();

create table if not exists public.measurement_market_service_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_identity_key text not null,
  candidate_label text not null,
  normalized_label text not null,
  source_url text not null,
  source_domain text not null,
  source_title text,
  evidence_note text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','merged')),
  seen_count integer not null default 1 check(seen_count >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists measurement_market_service_candidates_uq
on public.measurement_market_service_candidates(business_identity_key, normalized_label, source_url);

alter table public.measurement_market_service_candidates enable row level security;
revoke all on table public.measurement_market_service_candidates from anon, authenticated;
grant select, insert, update, delete on table public.measurement_market_service_candidates to service_role;
