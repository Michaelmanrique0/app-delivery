-- Ejecutar en SQL Editor DESPUÉS de 001_initial.sql si ya tenías cuentas en
-- Authentication antes de crear la tabla profiles (el trigger solo actúa en usuarios NUEVOS).

insert into public.profiles (id, email, full_name, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  case
    when not exists (select 1 from public.profiles where role = 'admin')
      and u.id = (
        select id from auth.users
        order by created_at asc nulls last
        limit 1
      )
    then 'admin'
    else 'repartidor'
  end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
