# Instalar esta versión de leihs desde cero

Esta guía instala la versión de leihs de ENTI-UB, con todo lo que se describe en
[FEATURES.md](FEATURES.md), en un servidor nuevo. El despliegue es el de leihs oficial (Ansible, en
el submódulo [`deploy`](deploy/README.md)). La diferencia clave es que hay que apuntarlo a **este**
repositorio y no al de leihs oficial.

> **Atención:** la plantilla oficial `leihs-instance` trae leihs **oficial**. Si se salta el paso 2,
> se instala leihs sin ninguno de los cambios de esta versión, y no da ningún error.

## Qué hace falta

- **Un servidor** Debian o Ubuntu LTS dedicado a leihs (ENTI usa Ubuntu 24.04), con acceso por SSH
  como root, o con un usuario con `sudo`.
- **Un nombre** (por ejemplo `leihs.mi-area.example.edu`) que llegue al servidor, y un certificado
  HTTPS. Por defecto el despliegue usa un certificado autofirmado. Se puede poner uno propio
  redefiniendo `leihs_virtual_hosts` (ver [deploy/defaults.yml](deploy/defaults.yml)), o dejar el
  servidor detrás de un proxy que ponga el HTTPS (como ENTI, con Cloudflare); en ese caso conviene
  `reverse_proxy_use_x_forwarded_for: true`.
- **Herramientas de compilación** en la máquina desde donde se despliega. La lista está en
  [deploy/README.md](deploy/README.md#on-the-deploy--control-machine). Esa máquina puede ser el
  mismo servidor: así se hace en ENTI, con las herramientas instaladas por `mise`.
- **Git** y acceso a GitHub. Todos los repositorios son públicos: no hace falta cuenta.

## 1. La carpeta del despliegue

La carpeta del despliegue sale de la plantilla oficial `leihs-instance`. Guarda el inventario de
Ansible (a qué servidor se despliega y con qué variables) y lleva leihs como submódulo.

```bash
git clone https://github.com/leihs/leihs-instance.git leihs-hosting
cd leihs-hosting
```

## 2. Apuntar a esta versión de leihs

Hay que cambiar el submódulo `leihs` de la plantilla para que use este repositorio, en la versión
publicada (un tag `enti-…`; la lista está en
[Releases y tags](https://github.com/unstable7345/leihs/tags)):

```bash
git submodule set-url leihs https://github.com/unstable7345/leihs.git
git submodule sync
git submodule update --init leihs
cd leihs
git fetch --tags
git checkout enti-2026.11
git submodule sync --recursive
git submodule update --init --recursive
cd ..
```

Para comprobarlo, `git -C leihs log --oneline -1` tiene que mostrar el commit del tag, y debe existir
`leihs/FEATURES.md`.

Con `main` en vez del tag se instala lo último, que puede estar a medio probar. Para un servicio
en uso, conviene un tag.

## 3. El inventario

En `hosts.yml` se reemplaza el host de ejemplo (`demo`) por el servidor propio. Un ejemplo mínimo:

```yaml
all:
  hosts:
    leihs:
      ansible_host: leihs.mi-area.example.edu   # o la IP
      ansible_user: root
      leihs_external_hostname: leihs.mi-area.example.edu
      db_backup_on_deploy: Yes
      leihs_send_mails: Yes
leihs_server:
  hosts:
    leihs:
```

- `leihs_external_hostname` es la dirección con la que la gente entra. leihs arma todos sus
  enlaces con ella.
- El grupo `zhdk` de la plantilla es de ZHdK y no hace falta.
- Si el servidor despliega sobre sí mismo, se usa `ansible_host: localhost` y
  `ansible_connection: local`. Con un usuario con `sudo` en vez de root, se quita `ansible_user` y
  se despliega con `-K` (paso 4).
- Si se va a usar el inicio de sesión con Microsoft, hay que agregar ya esta variable al host, porque
  cada despliegue rehace la configuración de Apache:

  ```yaml
      reverse_proxy_custom_config: |
        ProxyPass /ms-auth http://localhost:3999/ms-auth nocanon retry=0
  ```

El resto de las variables, con sus valores por defecto, está en
[deploy/defaults.yml](deploy/defaults.yml). Lo que se ponga en el inventario les gana.

## 4. Desplegar

```bash
./bin/demo-leihs-deploy
```

- Con `sudo` en vez de root: `./bin/demo-leihs-deploy -K`, que pide la contraseña de `sudo`.
- La primera vez tarda bastante (instala Postgres, Java, Ruby y Node, y compila todas las apps).
- Si las herramientas están instaladas con `mise`, deben estar en el `PATH`. Si no, borrow falla con
  `npm: command not found`:

  ```bash
  PATH="$HOME/.local/share/mise/shims:$PATH" ./bin/demo-leihs-deploy -K
  ```

El despliegue crea la base de datos y aplica todas las migraciones, también las de esta versión.

## 5. El primer administrador

Al entrar por primera vez a `https://leihs.mi-area.example.edu`, leihs redirige a un formulario para
crear el primer administrador, porque todavía no existe ninguno. Después se entra con esa cuenta y
el resto se configura en **Admin**.

## 6. Configuración básica en Admin

1. **Settings → SMTP:** el servidor de correo, para que salgan los mails.
2. **Languages:** el idioma por defecto (castellano o catalán, si se quiere).
3. **Settings → Misc:** el logo («Logo Light» y, si se quiere, «Logo Dark»).
4. **Inventory Pools:** crear los inventarios, sus horarios (Opening Times) y sus grupos de
   asignación.
5. Lo propio de cada feature (reservas por horas, email de avisos, etc.), como se explica en
   [FEATURES.md](FEATURES.md).

## 7. Servicios opcionales

Estos dos servicios no los instala el despliegue: se instalan a mano, una vez, en el servidor.
Necesitan que TI registre una app en Microsoft Entra.

- **Inicio de sesión con Microsoft:** [ms-auth-bridge/README.md](ms-auth-bridge/README.md).
- **Reservas en calendarios de Outlook:** [calendar-sync/README.md](calendar-sync/README.md).

Los dos quedan como servicios de systemd y siguen funcionando después de cada despliegue.

## Actualizar a una versión nueva

```bash
cd leihs-hosting/leihs
git fetch --tags
git checkout enti-AAAA.MM          # el tag nuevo
git submodule sync --recursive
git submodule update --init --recursive
cd ..
./bin/demo-leihs-deploy            # con -K y el PATH de mise si hace falta
```

Con `db_backup_on_deploy: Yes`, el despliegue guarda un backup de la base antes de migrar.

Si la versión nueva cambia `ms-auth-bridge` o `calendar-sync`, hay que volver a copiar su código
según su README. La lista de cambios de cada tag lo dice.
