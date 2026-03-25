-- Ejecutar en Supabase: SQL Editor > New query > pegar y Run
-- O usar: supabase db push (CLI)

-- Perfiles vinculados a auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'repartidor' check (role in ('admin', 'repartidor')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Primer usuario registrado = admin; los siguientes = repartidor
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt int;
begin
  select count(*) into cnt from public.profiles;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when cnt = 0 then 'admin' else 'repartidor' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Pedidos
create table if not exists public.pedidos (
  id bigint primary key,
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  nombre text,
  telefono text,
  direccion text,
  valor text not null default '0',
  map_url text,
  texto_original text,
  coords_lat double precision,
  coords_lng double precision,
  productos jsonb not null default '[]'::jsonb,
  en_curso boolean not null default false,
  posicion_pendiente int,
  entregado boolean not null default false,
  no_entregado boolean not null default false,
  envio_recogido boolean not null default false,
  notificado_en_camino boolean not null default false,
  llego_destino boolean not null default false,
  cancelado boolean not null default false,
  metodo_pago_entrega text not null default '',
  monto_nequi numeric not null default 0,
  monto_daviplata numeric not null default 0,
  monto_efectivo numeric not null default 0,
  sort_index int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists pedidos_assigned_to_idx on public.pedidos (assigned_to);
create index if not exists pedidos_sort_idx on public.pedidos (sort_index, id);

alter table public.pedidos enable row level security;

-- Políticas profiles (drop si re-ejecutas el script)
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Políticas pedidos
drop policy if exists pedidos_select on public.pedidos;
drop policy if exists pedidos_insert on public.pedidos;
drop policy if exists pedidos_update_admin on public.pedidos;
drop policy if exists pedidos_update_rep on public.pedidos;
drop policy if exists pedidos_delete on public.pedidos;
create policy pedidos_select on public.pedidos
  for select using (public.is_admin() or assigned_to = auth.uid());

create policy pedidos_insert on public.pedidos
  for insert with check (public.is_admin());

create policy pedidos_update_admin on public.pedidos
  for update using (public.is_admin()) with check (public.is_admin());

create policy pedidos_update_rep on public.pedidos
  for update using (assigned_to = auth.uid()) with check (assigned_to = auth.uid());

create policy pedidos_delete on public.pedidos
  for delete using (public.is_admin());

-- Admin puede cambiar rol de otros usuarios (vía UPDATE profiles)
-- Realtime (opcional; activar en Dashboard > Realtime si hace falta)
alter publication supabase_realtime add table public.pedidos;
