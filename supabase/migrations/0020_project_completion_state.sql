-- Project completion is a human decision. Completed projects are excluded from
-- automation ticks until a human explicitly resumes them.
alter type public.project_state add value if not exists 'completed' after 'active';
