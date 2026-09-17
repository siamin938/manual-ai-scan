-- Pure production classifier contracts, executed only in the disposable CI database.
do $$
begin
 if not public.is_generic_location_business_description('도심로 인근 수입차 전문 사설 정비소')
 or not public.is_generic_location_business_description('역 근처 자동차 정비업체')
 or public.is_generic_location_business_description('인근모터스 강남점')
 or public.is_generic_location_business_description('새빛자동차공업사')
 or public.get_auto_business_brand_core_v01('새빛㈜ 북부센터') <> public.get_auto_business_brand_core_v01('새빛 북부센터')
 or public.get_auto_business_brand_core_v01('(주)새빛 북부센터') <> public.get_auto_business_brand_core_v01('새빛 북부센터')
 or public.get_auto_business_brand_core_v01('새빛 북부센터') = public.get_auto_business_brand_core_v01('새빛 남부센터') then
  raise exception 'Generic description or corporate notation regression';
 end if;
end;
$$;
