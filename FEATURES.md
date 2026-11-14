# Qué agrega esta versión de leihs

Esta es la versión de leihs que usa ENTI-UB (leihs.enti.cat). Parte de leihs 7.15.3 oficial
(ZHdK) y le suma lo que se lista abajo. Todo está en la rama `main` de
[unstable7345/leihs](https://github.com/unstable7345/leihs) y sus submódulos.

La instalación se explica en [INSTALL.md](INSTALL.md). Cada feature indica si funciona sola o si hay
que activarla en algún lado.

| Feature | Dónde se ve | Hay que activarlo |
| --- | --- | --- |
| Reservas por horas | borrow, lending, mails | Sí, por inventario |
| Castellano y catalán completos | todas las apps | No |
| Bucs y salas como paquetes | borrow | No (se arman como paquetes) |
| Fabricante en el nombre del modelo | todas las apps | No |
| Códigos de inventario por campos | Inventory | No |
| Etiquetas en artículos | Inventory | No (se crean por inventario) |
| Filtro por sala | Inventory | No |
| Páginas anchas y más grandes | Lending, Inventory, Manage | No |
| Modo oscuro | borrow | No (lo elige cada persona) |
| Logo propio | borrow, lending, barra de legacy | Sí, en Admin |
| Email de avisos de pedidos | mails | Opcional, por inventario |
| Límite de cantidad al reservar | borrow | No |
| Inicio de sesión con Microsoft | login | Sí: servicio aparte |
| Reservas en calendarios de Outlook | Outlook | Sí: servicio aparte |

## Reservas por horas

Un inventario puede ofrecer reservas por horas, además de por días completos. La gente elige
inicio y fin en pasos de 30 minutos, dentro del horario del inventario, y puede reservar varios días
seguidos por horas. Un día completo cuenta de la apertura al cierre.

- **Activar:** Admin → Inventory Pools → (inventario) → Opening Times → «Edit Reservations by
  the Hour»: marcar «Offer reservations by the hour» y poner la hora de inicio y de fin.
- **Límite de horas:** en cada grupo de asignación (Entitlement Groups), «Max. hours per
  reservation (by the hour)». Si una persona está en varios grupos, vale el límite más alto; vacío
  es sin límite.
- En un inventario por horas, **solo puede reservar quien pertenece a alguno de sus grupos.**
- No se puede reservar una franja que ya pasó, ni retirar hoy después del cierre.
- El personal puede pasarse del límite desde lending.
- Lending muestra y permite cambiar las horas de cada línea (pedidos, entrega, devolución,
  contrato).
- Las plantillas de mail tienen variables con el horario de cada reserva.

## Idiomas

- **Castellano (es)** completo en borrow, lending, Inventory, Manage, procure y mails.
- **Catalán (ca)** completo en las mismas apps.
- Se corrigieron textos que leihs oficial dejaba fijos en alemán en todos los idiomas.

Cada persona elige su idioma en su perfil. El idioma por defecto se elige en Admin → Languages.

## Inventario

- **Fabricante en el nombre del modelo:** el modelo se muestra como «Fabricante Modelo» en todas
  partes (catálogo, listas, contratos), sin repetir el fabricante.
- **Códigos de inventario por campos:** al crear varios artículos a la vez, el código se arma con
  hasta 3 campos del artículo, un separador y un contador.
- **Etiquetas:** cada inventario define sus etiquetas (Inventory → Tags) y las pone en sus artículos,
  también desde la lista del inventario. La lista se puede filtrar por una o varias etiquetas
  (aparecen los artículos que tienen todas).
- **Código y etiquetas desde la lista:** a la izquierda de cada artículo hay botones para cambiar el
  código y las etiquetas sin abrir el formulario.
- **Filtro por sala** en la lista del inventario.

## Bucs y salas como paquetes

Una sala o un buc se carga como un modelo-paquete con sus artículos adentro. En borrow, la ficha de
un modelo-paquete muestra la sección «Contenido» con lo que incluye.

## Aspecto

- **Lending, Inventory y Manage** se ven un 10% más grandes y usan el ancho de las pantallas
  anchas (entre 970 y 1200 px).
- **Modo oscuro en borrow:** cada persona elige claro, oscuro o el del sistema desde el menú de
  usuario.
- **Logo propio:** en Admin → Settings → Misc se sube «Logo Light» (y, si se quiere, «Logo Dark»
  para el modo oscuro). Se usa en borrow, en lending y en la barra de arriba de Lending, Inventory y
  Manage. Si no hay ninguno, se ve el texto «leihs».

## Avisos y reservas

- **Email de avisos:** Admin → Inventory Pools → (inventario) → «Notification Email». Los avisos de
  pedido recibido van a esa dirección en vez de la del inventario; el remitente sigue siendo la del
  inventario.
- **Límite de cantidad:** borrow no deja pedir más unidades que el máximo disponible en el
  inventario.

## Inicio de sesión con Microsoft (Entra ID)

Servicio aparte, `ms-auth-bridge`, que deja entrar con la cuenta de Microsoft de la universidad y,
si se quiere, crea la cuenta de leihs la primera vez. El botón de login lleva el estilo de Microsoft
cuando el sistema de autenticación tiene el id `microsoft`.

Requiere una app registrada en Microsoft Entra (la registra TI). Instalación y configuración:
[ms-auth-bridge/README.md](ms-auth-bridge/README.md).

## Reservas en calendarios de Outlook

Servicio aparte, `calendar-sync`, que copia cada minuto las reservas aprobadas de una categoría (por
ejemplo «Espacios») como eventos en el calendario de un buzón de Microsoft 365. Pone un calendario
por espacio e invita a quien reservó.

- **Activar:** Admin → Categories → (categoría) → «Outlook calendar» = el buzón.
- Requiere una app en Microsoft Entra con permiso sobre ese buzón (lo da TI con Exchange RBAC).
  Instalación y configuración: [calendar-sync/README.md](calendar-sync/README.md).
- Va en una sola dirección: lo que se cambie en Outlook se pierde en la siguiente vuelta.
