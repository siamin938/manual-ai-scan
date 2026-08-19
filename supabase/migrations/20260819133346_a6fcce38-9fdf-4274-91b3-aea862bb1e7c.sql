GRANT SELECT ON public.run_metrics TO authenticated;
GRANT SELECT ON public.run_metrics_overall TO authenticated;
GRANT SELECT ON public.question_metrics TO authenticated;
GRANT SELECT ON public.run_business_share TO authenticated;
GRANT SELECT ON public.experiment_effects TO authenticated;
GRANT SELECT ON public.experiment_effects_by_provider TO authenticated;
GRANT SELECT ON public.run_metrics, public.run_metrics_overall, public.question_metrics, public.run_business_share, public.experiment_effects, public.experiment_effects_by_provider TO service_role;