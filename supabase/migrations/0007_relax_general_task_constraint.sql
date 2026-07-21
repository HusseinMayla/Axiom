-- Drop the old constraint that blocked planning multiple active general tasks globally
drop index if exists public.one_active_general_task;

-- Create a relaxed project-scoped constraint that only prevents multiple general tasks 
-- from actively executing (running, pending review, or waiting for human approval) at the same time
create unique index one_active_general_task
  on public.tasks (project_id, category)
  where category = 'general' and state in ('running', 'pending_review', 'waiting_for_human_approval');
