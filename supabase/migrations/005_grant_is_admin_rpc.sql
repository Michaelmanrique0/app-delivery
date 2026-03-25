-- Permite al cliente llamar rpc('is_admin') con JWT de authenticated (sin esto suele fallar en silencio).

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
