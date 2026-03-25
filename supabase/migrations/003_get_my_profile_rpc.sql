-- Perfil del usuario actual sin depender de evaluar is_admin() en la política SELECT de profiles
-- (evita ciclos / comportamientos raros de RLS al leer la propia fila).

create or replace function public.get_my_profile()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.role, p.created_at
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;
