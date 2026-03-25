-- Evaluar primero la fila propia: evita depender de is_admin() para leer el propio perfil
-- (is_admin() hace un SELECT a profiles; en algunos casos complica la evaluación de políticas).

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
