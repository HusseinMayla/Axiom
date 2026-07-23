-- Feature completion is a human decision. AI work moves an approved feature
-- into development but never closes it.
alter type public.feature_status add value if not exists 'in_development' after 'active';
