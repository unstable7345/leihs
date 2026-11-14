# leihs · versión ENTI-UB

Sistema de préstamo y reservas de equipos y espacios que usa ENTI-UB en
[leihs.enti.cat](https://leihs.enti.cat). Es una versión propia de
[leihs](https://github.com/leihs/leihs), el sistema libre de la Zürcher Hochschule der Künste (ZHdK),
basada en **leihs 7.15.3**, con cambios pensados para una universidad de habla castellana y catalana
que trabaja con Microsoft 365.

> Este no es el repositorio oficial de leihs, y ZHdK no da soporte a esta versión.

- **Qué agrega, y qué hay que activar:** [FEATURES.md](FEATURES.md)
- **Cómo instalarla desde cero:** [INSTALL.md](INSTALL.md)
- **Versiones publicadas:** [tags `enti-…`](https://github.com/unstable7345/leihs/tags). La última es
  `enti-2026.11`.

## Qué cambia respecto de leihs oficial

**Reservas por horas.** Además de días completos, un inventario puede ofrecer reservas por horas,
en pasos de 30 minutos y dentro de su horario, con un límite de horas por grupo. Funciona de punta a
punta: en el catálogo (borrow), en la gestión del préstamo (lending), en los contratos y en los
mails.

**Castellano y catalán completos.** Las dos traducciones cubren borrow, lending, Inventory, Manage,
procure y los mails. Además se corrigieron textos que leihs oficial deja fijos en alemán en todos los
idiomas.

**Inicio de sesión con Microsoft.** Con el servicio [`ms-auth-bridge`](ms-auth-bridge/README.md) se
entra con la cuenta institucional (Microsoft Entra ID), y la cuenta de leihs se puede crear sola la
primera vez.

**Reservas en calendarios de Outlook.** El servicio [`calendar-sync`](calendar-sync/README.md) copia
las reservas aprobadas de una categoría (por ejemplo, salas y bucs) a un buzón de Microsoft 365, con
un calendario por espacio, e invita a quien reservó.

**Inventario más cómodo.**
- El fabricante va en el nombre del modelo.
- Los códigos de inventario se arman con campos del artículo al crear varios a la vez.
- Hay etiquetas por inventario, que se ponen desde la misma lista, y filtros por etiquetas y por
  sala.

**Espacios como paquetes.** Una sala o un buc se carga como un modelo-paquete, y el catálogo muestra
lo que incluye.

**Aspecto.**
- Modo oscuro en el catálogo.
- Logo propio en todas las apps.
- Lending, Inventory y Manage aprovechan las pantallas anchas.

**Avisos.** Cada inventario puede mandar los avisos de pedido recibido a una dirección propia.

El detalle de cada cambio, y dónde se configura, está en [FEATURES.md](FEATURES.md).

## Repositorios

leihs está repartido en varios repositorios, que este proyecto incluye como submódulos. Los que
tienen cambios propios están en forks de esta cuenta. El resto se usa tal cual, en la versión de
leihs 7.15.3.

| Submódulo | Repositorio | Cambios propios |
| --- | --- | --- |
| `admin` | [unstable7345/leihs-admin](https://github.com/unstable7345/leihs-admin) | Sí |
| `borrow` | [unstable7345/leihs-borrow](https://github.com/unstable7345/leihs-borrow) | Sí |
| `database` | [unstable7345/leihs_database](https://github.com/unstable7345/leihs_database) | Sí |
| `legacy` (Lending, Inventory, Manage) | [unstable7345/leihs_legacy](https://github.com/unstable7345/leihs_legacy) | Sí |
| `legacy/public/assets` | [unstable7345/leihs_legacy_assets](https://github.com/unstable7345/leihs_legacy_assets) | Sí |
| `borrow/shared-clj` | [unstable7345/leihs-clj-shared](https://github.com/unstable7345/leihs-clj-shared) | Sí |
| `my` (login y perfil) | [unstable7345/leihs-my](https://github.com/unstable7345/leihs-my) | Sí |
| `procure` | [unstable7345/leihs-procure](https://github.com/unstable7345/leihs-procure) | Sí |
| `deploy`, `inventory`, `lending`, `mail` y otros | [leihs](https://github.com/leihs) | No |

Los servicios `ms-auth-bridge` y `calendar-sync` viven en este mismo repositorio.

## Ramas

- **`main`** es la rama principal, en todos los forks. Lo nuevo sale de `main` en una rama
  `feature/…` y vuelve a `main` cuando está probado.
- **`master`** es la de leihs oficial y no tiene estos cambios. No sirve como base.

## Créditos y licencia

leihs es (C)
* [Zürcher Hochschule der Künste (Zurich University of the Arts)](http://www.zhdk.ch),
* Functional LLC, Zürich, Suiza, y
* sus colaboradores.

Los cambios de esta versión son de ENTI-UB. Todo el conjunto es
[software libre](http://www.gnu.org/philosophy/free-sw.html) bajo la
[GNU General Public License (GPL) v3](http://www.gnu.org/licenses/gpl-3.0.txt), igual que leihs. El
detalle está en el archivo LICENSE.

La documentación de leihs oficial (wiki, demo, especificaciones) está en
[github.com/leihs/leihs](https://github.com/leihs/leihs).
