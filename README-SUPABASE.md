# Supabase: configuración

## 1. Crear proyecto

En [Supabase](https://supabase.com) crea un proyecto y anota **Project URL** y **anon public** key (Settings → API).

## 2. Base de datos (obligatorio: tabla `profiles` y `pedidos`)

La app **no crea tablas sola**: debes ejecutar el SQL en tu proyecto.

1. En Supabase: **SQL Editor** → **New query**.
2. Abre el archivo del repo `supabase/migrations/001_initial.sql`, copia **todo** el contenido, pégalo y pulsa **Run**.

Para comprobar: **Table Editor** → esquema **`public`** → deberías ver las tablas **`profiles`** y **`pedidos`**. Si no aparecen, el script no se ha ejecutado (o falló antes del final; revisa el mensaje de error en SQL Editor).

**Si ya tenías usuarios en Authentication** antes de ejecutar `001_initial.sql`, esos usuarios **no** tendrán fila en `profiles` (el trigger solo corre al registrarse alguien nuevo). En ese caso, después de `001` ejecuta también `supabase/migrations/002_backfill_profiles_usuarios_existentes.sql` para crear las filas faltantes (el usuario más antiguo en `auth.users` será `admin` si aún no hay ningún admin en `profiles`).

Si al final de `001` aparece error porque `pedidos` ya está en la publicación Realtime, omite la última línea `alter publication supabase_realtime add table public.pedidos;` o actívala desde **Database → Replication**.

## 3. Autenticación

En **Authentication → Providers**, habilita **Email**.  
Desactiva **Confirm email** en **Authentication → Providers → Email** para que el registro desde la app funcione sin confirmar bandeja (recomendado).

En la app, **Registro** pide **nombre, correo electrónico, usuario y contraseña**. Supabase usa el **correo** como identificador de acceso; el **usuario** se guarda en metadata (`app_username`) y el perfil copia el correo desde Auth. Para entrar se puede usar el **correo** o, en cuentas antiguas, solo el usuario (email técnico `usuario@users.app-delivery.invalid`).

También puedes crear usuarios manualmente en **Authentication → Users → Add user**; en el login deben usar el mismo identificador (correo completo o solo la parte antes del `@` si coincide con el dominio interno de la app).

## 4. Configuración en la app

Edita `supabase-config.js` y pon tu **Project URL** y **anon public** key (puedes partir de `supabase-config.example.js` como referencia).

No subas a repositorios públicos una clave real sin revisar riesgos; rota la clave si se filtra.

## 5. Primer usuario = administrador

El **primer usuario** que exista en `auth.users` recibe rol `admin` en `profiles` (trigger de la migración). Los siguientes serán `repartidor` hasta que un admin cambie el rol en la app.

## 6. Despliegue

Sirve los archivos por **HTTPS** (Netlify, Vercel, GitHub Pages, etc.) para que la autenticación y cookies funcionen bien.
