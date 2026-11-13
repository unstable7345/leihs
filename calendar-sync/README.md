# Reservas de leihs en calendarios de Outlook

Servicio pequeño que copia las reservas de ciertas categorías de leihs como eventos en el calendario
de un buzón de Microsoft 365, por ejemplo los bucs y espacios en el calendario de `so@enti.cat`.

```
leihs (Postgres) ──cada minuto──▶ calendar-sync ──Microsoft Graph──▶ calendario de so@enti.cat
```

## Qué hace

- **Qué se copia:** las reservas de los modelos de una categoría con **Outlook calendar** en el admin,
  incluidas sus subcategorías, desde hoy en adelante. Por defecto, solo las aprobadas, las entregadas y
  las devueltas (`SYNC_STATUSES`).
- **El evento:** «Buc 3 — Nombre Apellido», con el motivo y el inventario en la descripción. Las
  reservas por horas tienen su horario y las de días completos son eventos de todo el día. No lleva
  invitados, así que no se envía ninguna invitación.
- **Cambios:** si la reserva cambia de fecha u hora, se modifica el mismo evento. Si se cancela, se
  rechaza o se borra, el evento desaparece.
- **Historial:** cuando una reserva termina, su evento se queda en el calendario y el servicio deja de
  seguirlo.
- **Una sola dirección:** leihs manda. Un evento editado en Outlook se sobrescribe en el siguiente
  cambio de la reserva, y uno borrado vuelve a crearse.
- **Si se vacía el campo** de la categoría, se borran sus eventos futuros y los pasados se quedan. Si se
  cambia la dirección, los futuros pasan al calendario nuevo.

El calendario se llama «Reservas leihs» (`CALENDAR_NAME`) y se crea solo si no existe.

**Un calendario por espacio** (`CALENDAR_GROUP=Reservas leihs`): en lugar de un solo calendario, cada
espacio tiene el suyo, con el nombre del modelo en leihs («Buc 1», «Sala de Control»…), dentro de un grupo
de calendarios con ese nombre. El grupo y cada calendario se crean con la primera reserva aprobada de ese
espacio. Si una reserva cambia de modelo, su evento pasa al calendario del otro espacio: Outlook no mueve
eventos entre calendarios, así que se borra y se crea de nuevo (quien reservó recibe la cancelación y una
invitación nueva). Al activarlo, los eventos futuros del calendario único pasan a su espacio de la misma
forma; el calendario único queda vacío y se puede borrar a mano. Necesita la migración 083 de leihs.

**Invitaciones** (`INVITE_BOOKER=true`): quien hizo la reserva (en una delegación, la persona que reservó
por ella) es invitado al evento. Exchange le envía la invitación desde el buzón, y también la actualización
si cambia la hora y la cancelación si la reserva se anula o se borra. El evento no pide respuesta, así que
el buzón no recibe aceptaciones ni rechazos. No hace falta ningún permiso más que el de calendario. Al
activarlo, los eventos futuros que ya existían se actualizan y sus reservas también reciben la invitación.

## 1. Microsoft: la app y el permiso

**En Microsoft Entra** (no hace falta ser admin, solo poder registrar apps):

1. **App registrations → New registration:** `leihs-calendar-sync`, solo este directorio, sin
   redirect URI.
2. **API permissions:** no añadir ningún permiso. El acceso lo da Exchange, limitado a un buzón; un
   permiso de calendario concedido en Entra daría acceso a todos los buzones.
3. **Certificates & secrets:** crear un secreto, copiar su **Value** y anotar cuándo caduca.
4. **Enterprise applications:** buscar la app y anotar **Application ID** y **Object ID**. No sirven los
   de App registrations, que muestra otros valores.

**En Exchange Online**, con un usuario Exchange Administrator:

```powershell
Connect-ExchangeOnline
Get-Mailbox so@enti.cat | Format-List RecipientTypeDetails
New-ServicePrincipal -AppId <APPLICATION_ID> -ObjectId <OBJECT_ID> -DisplayName "leihs-calendar-sync"
New-ManagementScope -Name "leihs calendario so" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'so@enti.cat'"
New-ManagementRoleAssignment -App <OBJECT_ID> -Role "Application Calendars.ReadWrite" -CustomResourceScope "leihs calendario so"
Test-ServicePrincipalAuthorization -Identity <OBJECT_ID> -Resource so@enti.cat | Format-Table
```

- `Get-Mailbox` tiene que dar `UserMailbox` o `SharedMailbox`. Con un grupo de Microsoft 365 no funciona.
- El último comando tiene que dar `InScope = True` para `so@enti.cat`.
- El permiso tarda entre 30 minutos y 2 horas en aplicarse.
- Para sumar otro buzón, hay que ampliar el filtro del scope, por ejemplo con
  `-or PrimarySmtpAddress -eq 'otro@enti.cat'` en `Set-ManagementScope`.

## 2. Instalar el servicio en el servidor

Hace falta Node 22 o superior accesible para todos los usuarios del sistema. Si `which node` no es
`/usr/bin/node`, hay que cambiar `ExecStart` en el archivo `.service`. Los comandos se ejecutan desde
la carpeta `calendar-sync`.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin leihs-calendar-sync
sudo mkdir -p /opt/leihs-calendar-sync /etc/leihs-calendar-sync
sudo cp -r package.json package-lock.json src /opt/leihs-calendar-sync/
(cd /opt/leihs-calendar-sync && sudo npm ci --omit=dev)
sudo cp .env.example /etc/leihs-calendar-sync/env
sudo chown -R leihs-calendar-sync: /etc/leihs-calendar-sync
sudo chmod 600 /etc/leihs-calendar-sync/env
sudo cp deploy/leihs-calendar-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
```

La conexión a la base de datos sale de `/etc/leihs/config.env`, el mismo archivo que usan los
servicios de leihs, así que no hay que copiar la contraseña. leihs tiene que estar desplegado con la
migración 081 (campo y tabla nuevos) y con el admin que muestra el campo.

Para actualizar el código más adelante, se repiten las líneas de `cp` y `npm ci` y se reinicia con
`sudo systemctl restart leihs-calendar-sync`.

## 3. Probar sin tocar el calendario

El modo de prueba lee leihs y escribe en pantalla qué haría, sin conectar con Microsoft ni guardar
nada. Sirve antes de tener el permiso:

```bash
sudo systemd-run --pipe --wait --uid=leihs-calendar-sync -p EnvironmentFile=/etc/leihs/config.env -p WorkingDirectory=/opt/leihs-calendar-sync /usr/bin/node src/main.js --dry-run --once
```

Cada evento sale como una línea `would_create`, con el título y el horario, y al final un resumen
`dry_run_done`. Si no sale ninguno, revisá que la categoría tenga el campo **Outlook calendar** y que
haya reservas aprobadas desde hoy.

## 4. Activarlo

1. Completar `/etc/leihs-calendar-sync/env` con los datos de Entra.
2. En **Admin → Categories**, editar la categoría (por ejemplo, «Espacios») y poner `so@enti.cat` en
   **Outlook calendar**.
3. Arrancar:

```bash
sudo systemctl enable --now leihs-calendar-sync
journalctl -u leihs-calendar-sync -f
```

En el registro, cada evento creado, modificado o borrado sale como una línea `create`, `update` o
`delete`. Un error de permisos aparece como `create_failed` con estado 403: o el permiso todavía no se
aplicó, o el buzón no está en el scope de Exchange. El servicio lo reintenta cada minuto.

**Cuando caduca el secreto**, todo falla con estado 401: hay que crear otro en Entra, cambiar
`MS_CLIENT_SECRET` y reiniciar el servicio.

## Comprobaciones

| Prueba | Resultado esperado |
| --- | --- |
| Reserva de un buc por horas, aprobada | Evento con ese horario en «Reservas leihs» en 1 minuto |
| Reserva de días completos, aprobada | Evento de todo el día que cubre esos días |
| Reserva pendiente de aprobación | No aparece |
| Cambiar la hora de una reserva aprobada | El mismo evento cambia de hora |
| Rechazar la reserva o borrar su línea | El evento desaparece |
| Reserva de un modelo de otra categoría | No aparece |
| Borrar el evento en Outlook y cambiar la reserva | El evento vuelve |
| Vaciar el campo de la categoría | Desaparecen los eventos futuros; los pasados se quedan |
| Reserva que ya terminó | Su evento se queda en el calendario |

## Desarrollo

```bash
npm install
npm test
```
