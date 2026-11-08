# Inicio de sesión con Microsoft para leihs

Servicio pequeño que conecta leihs con Microsoft Entra ID mediante OpenID Connect. Para leihs es un
"sistema de autenticación externo" normal, así que no requiere cambios en su código.

```
leihs ──token firmado──▶ puente ──▶ login de Microsoft (MFA incluido)
leihs ◀──token firmado── puente ◀── identidad verificada
```

El correo con el que se entra es siempre el que afirma Microsoft, nunca el que se escribió en leihs.

## 1. Lo que hace TI en Microsoft Entra

En **App registrations → New registration**:

- **Supported account types:** solo este directorio (single tenant).
- **Redirect URI:** tipo **Web**, `https://leihs.enti.cat/ms-auth/callback`.
  Para pruebas, añadir también `https://magatzem.franzapps.duckdns.org/ms-auth/callback`.
- **Certificates & secrets:** crear un secreto de cliente y anotar cuándo caduca. Al caducar deja de
  funcionar el login, y hay que crear otro y actualizar `MS_CLIENT_SECRET`.

Datos que hacen falta: **Directory (tenant) ID**, **Application (client) ID** y el **valor** del secreto.

Hay que confirmar con TI que el correo de cada persona en leihs coincide con su nombre principal de
usuario (UPN) en Microsoft, que es lo que el puente usa para identificarla.

## 2. Instalar el servicio en el servidor

Hace falta Node 22 o superior accesible para todos los usuarios del sistema. Si `which node` no es
`/usr/bin/node`, hay que cambiar `ExecStart` en el archivo `.service`. Los comandos se ejecutan desde
la carpeta `ms-auth-bridge`.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin leihs-ms-auth
sudo mkdir -p /opt/leihs-ms-auth /etc/leihs-ms-auth
sudo cp -r package.json package-lock.json src /opt/leihs-ms-auth/
(cd /opt/leihs-ms-auth && sudo npm ci --omit=dev)
sudo ./scripts/generate-keys.sh /etc/leihs-ms-auth
sudo cp .env.example /etc/leihs-ms-auth/env
sudo chown -R leihs-ms-auth: /etc/leihs-ms-auth
sudo chmod 600 /etc/leihs-ms-auth/env
sudo cp deploy/leihs-ms-auth.service /etc/systemd/system/
sudo cp deploy/leihs_050_ms_auth.conf /etc/apache2/leihs/conf.d/
```

**El despliegue de leihs borra `/etc/apache2/leihs` cada vez**, y con ella este archivo: después de
desplegar, el botón lleva a un "Not Found" de Apache. Para que la regla sobreviva, hay que añadirla
también a las variables del host en el inventario del despliegue (el archivo donde está
`leihs_external_base_url`), y el despliegue la escribe en `leihs_900_custom.conf`:

```yaml
reverse_proxy_custom_config: |
  ProxyPass /ms-auth http://localhost:3999/ms-auth nocanon retry=0
```

Editar `/etc/leihs-ms-auth/env` con los datos de TI y arrancar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now leihs-ms-auth
sudo apachectl configtest && sudo systemctl reload apache2
curl https://leihs.enti.cat/ms-auth/health
```

El último comando debe responder `ok`. Los errores de inicio de sesión quedan en
`journalctl -u leihs-ms-auth`.

## 3. Configurar leihs

**Antes de nada:** comprobar que la cuenta de administrador tiene contraseña y que sabes usarla, para
no quedarte fuera si falla Microsoft.

En **Admin → System → Authentication Systems**, crear uno nuevo:

| Campo | Valor |
| --- | --- |
| `id` | `microsoft` (con este id el botón sale blanco con el logo de Microsoft) |
| `name` | `Login ENTI-UB` (es el texto del botón) |
| `type` | `external` |
| `enabled` | sí |
| `external_sign_in_url` | `https://leihs.enti.cat/ms-auth/sign-in` |
| `internal_private_key` | contenido de `private.pem` |
| `internal_public_key` | contenido de `public.pem` |
| `external_public_key` | contenido de `public.pem` |
| `send_email` | sí |

El mismo par de claves se usa en las dos direcciones. La documentación de leihs lo permite, y es lo que
deja al puente renovar el token de 90 segundos de leihs cuando alguien tarda más en superar el MFA.

**Una cuenta que no exista o no esté vinculada no puede entrar:** leihs muestra un error aunque
Microsoft la acepte. Para las cuentas hay dos opciones: vincularlas a mano, una a una o mediante un
grupo, o activar el alta automática del apartado siguiente.

Quien solo tenga este sistema y no tenga la contraseña activada pasa directamente a Microsoft tras
escribir su correo. Quien tenga las dos opciones ve ambas.

## 4. Alta automática (opcional)

Quien entre con un correo de los dominios permitidos obtiene una cuenta la primera vez, con el nombre
que da Microsoft y sin contraseña de leihs. Si ya tenía cuenta con ese correo, se vincula al sistema sin
modificarla, también si antes se le había quitado el vínculo a mano. Una cuenta desactivada sigue sin
poder entrar.

1. **Crear un usuario de servicio** en **Admin → Users**, con `is_admin`, para que las altas no queden a
   nombre de una persona.
2. **Crear su token** en la sección **API Tokens** de ese usuario, con los permisos `admin read` y
   `admin write`. Anotar cuándo caduca (por defecto, al año).
3. **Añadir a `/etc/leihs-ms-auth/env`:**
   ```
   LEIHS_API_TOKEN=el-token
   SIGN_UP_EMAIL_DOMAINS=enti.cat
   ```
   Si el servidor no llega a su propia dirección pública, añadir también `LEIHS_API_URL`.
4. **Reiniciar:** `sudo systemctl restart leihs-ms-auth`
5. **En el sistema Microsoft de leihs**, poner `sign_up_email_match` a `^[^@]+@enti\.cat$`. Es lo que hace
   que leihs ofrezca Microsoft a quien todavía no tiene cuenta.

Si el token caduca o la API falla, quien ya tiene cuenta y vínculo sigue entrando. Las altas nuevas fallan
con un error de leihs, y el motivo queda en el registro como `account_failed`.

**Tener cuenta no da permiso para reservar.** Hay que dar acceso a un inventory pool: a cada persona, a
un grupo, o al grupo de todos los usuarios, al que leihs añade automáticamente a cada cuenta nueva.

## Comprobaciones

| Prueba | Resultado esperado |
| --- | --- |
| Usuario vinculado entra con su cuenta de Microsoft | Abre sesión en leihs |
| Entra desde un enlace interno, como `/borrow/...` | Vuelve a esa página |
| Tarda más de 90 segundos en el login de Microsoft | Abre sesión igualmente |
| Cuenta de Microsoft sin usuario en leihs | leihs muestra un error y no abre sesión |
| Cancela en la pantalla de Microsoft | Página de error con enlace a leihs |
| Administrador entra con contraseña | Sigue funcionando |
| Alta automática: correo de `enti.cat` sin cuenta, primera entrada | Se crea la cuenta y abre sesión |
| Alta automática: esa persona entra otra vez | Usa la misma cuenta, sin duplicarla |

Cerrar sesión en leihs no cierra la sesión de Microsoft: en un ordenador compartido hay que cerrar
también el navegador.

## Desarrollo

```bash
npm ci
npm test
```

Las pruebas usan un Microsoft simulado. No sustituyen a una prueba con un inquilino real.
