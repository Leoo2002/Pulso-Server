# Server

## Datos de nomina en el JWT

El login con Google consulta `obtener_datos_usuario_nomina` con
`{ p_email: email }` del token Google verificado. Acepta el objeto
`{ datos, origen }` o una lista con una unica fila de ese formato.
Los campos de `datos` se incorporan a la raiz del JWT: `id`, `dni`, `mail`,
`lider`, `nombre`, `usuario`, `herramientas`, `rango`, `segmento` y `rol`
(si viene informado). `origen` se conserva en la raiz.

Nomina tiene prioridad: solo si `rol` o `rango` son nulos o faltan se consulta
`getrol` o `getrango`, respectivamente. Si falta `segmento` se mantiene
`SOPORTE-RRSS`; una lista vacia es valida y no activa ese valor anterior.
Sin registro (null, lista vacia o `datos: null`) se permite el login con
el esquema anterior y `nomina: null`. Un fallo RPC devuelve 500 y un formato
invalido 502, sin emitir cookie. No se ignoran errores de consulta.

Se conservan los claims de identidad de Google; la expiracion del JWT sigue
siendo de ocho horas. El login y `/auth/recargar-storage` devuelven el mismo
payload firmado, incluidos los datos de nomina. `rol` es el titulo del header,
no una fuente alternativa de autorizacion. Ticketera verifica por solicitud los
rangos y herramientas del JWT, sin volver a consultar asignaciones por RPC.
Las asignaciones permanecen vigentes hasta vencer la sesion (8 horas).
El acceso especial requiere `U_SECRET` configurado y usa el perfil fijo de
Desarrollo de Leonel Quiroga (`U936558`, rango 1, herramientas 10/11/12);
ignora el rango enviado por el navegador. Sin secreto devuelve 503.

Reiniciar el backend y volver a iniciar sesion para actualizar tokens existentes.
No requiere migraciones si la RPC ya esta desplegada. El frontend admite tanto
el segmento anterior (string) como la nueva lista de segmentos.

```powershell
node --test .\src\routes\auth.routes.test.js
```

## Alcance de alertas operativas

Las nuevas alertas se publican solo en la ticketera activa (`servicio`),
validada contra los accesos del usuario autenticado. `servicios` es opcional:
si se envia debe contener exactamente esa ticketera, incluso para administradores.
Publicacion y eliminacion admiten rangos 1 a 5, incluidos Lider, Jefatura y
Gerencia; siempre dentro de las herramientas asignadas en el JWT.

La eliminacion admite rangos 1 a 5, nunca agentes (0) ni perfiles invalidos.
Antes de ejecutar la RPC de borrado por ID, el servidor consulta las alertas
de la ticketera activa y verifica el ID y su pertenencia. Un ID ajeno o un
fallo de verificacion no ejecuta el borrado. Las alertas antiguas compartidas
requieren acceso a todos sus destinos, ya que el borrado es global.
No requiere migraciones; desplegar backend y frontend juntos.

## Optimizacion de imagenes antes de Supabase Storage

Las nuevas cargas de alertas operativas, `/crearTicketera` y `/tickets`
usan el mismo procesador `src/utils/optimize-image.js`, basado en `sharp`.
No requiere migraciones ni cambios de buckets.

- Decodifica el archivo real y comprueba que coincida con el MIME JPEG/PNG/WebP.
  Rechaza archivos corruptos, animaciones y entradas de mas de 40 megapixeles
  con un error 400 visible. Conserva los limites previos de bytes y permisos.
- Corrige orientacion EXIF, elimina metadatos y limita el lado mayor a 1920px,
  sin agrandar imagenes pequenas. Conserva la proporcion y transparencia.
- Codifica WebP con calidad 82. Si supera el peso de entrada, compara tambien
  una version limpia del formato de origen. Reutiliza el original unicamente
  si es mas liviano y ya cumple dimensiones, orientacion y ausencia de metadatos.
  La limpieza o reduccion obligatoria puede aumentar el peso en casos extremos;
  no se sacrifica legibilidad con recompresiones sucesivas para alcanzar un peso fijo.
- Guarda una sola version; la extension, el MIME y el peso registrado corresponden
  al archivo almacenado. En `ticketera_imagenes`, `nombre_original` conserva el
  nombre enviado como referencia; `ruta_archivo` y `tipo_mime` identifican la salida.
- Valida todos los adjuntos de una solicitud antes de subir el primero. Mantiene
  la limpieza de objetos y registros si falla la persistencia.

Los enlaces firmados y las descargas sirven directamente la version almacenada,
sin guardar miniaturas ni copias del original. No modifica imagenes existentes.
El ahorro depende del contenido: validar capturas con texto pequeno antes de
produccion; 1920px y calidad 82 son el criterio inicial, no una garantia de peso.

Despliegue: instalar las dependencias (`npm install`; este repositorio ignora
el lockfile) y reiniciar o redesplegar el backend. `sharp` requiere Node.js
18.17+ o 20.3+; usar un Node LTS
compatible y permitir instalar las dependencias opcionales nativas del sistema
destino. El frontend no necesita cambios para consumir WebP.

Pruebas locales, sin conectar con Supabase:

```powershell
node --test .\src\utils\optimize-image.test.js .\src\routes\image-uploads.routes.test.js .\src\routes\alertas-operativas.routes.test.js .\src\middlewares\ticketera-access.test.js
```

## Proxy de Render

Cuando Render define `RENDER=true`, Express confia en un salto de proxy
(`trust proxy = 1`) antes de los limitadores. Fuera de Render se mantiene
`trust proxy = false`. No usar `true` para confiar en toda la cadena ni
desactivar las validaciones de express-rate-limit.

Esto permite usar la IP que el proxy de entrada informa en X-Forwarded-For.
Si Netlify actua como proxy, esa IP puede ser la de Netlify y compartir
limites entre usuarios. No aumentar los saltos sin verificar la cadena y
restringir los caminos de acceso directo al backend.
Redesplegar el servidor para aplicar el ajuste.

## CORS

Se permiten solicitudes desde `https://pulso-arg.netlify.app`, el origen
configurado en `FRONTEND_URL`, `http://localhost:4200` y `http://localhost:3000`.
Los origenes se comparan sin barra final. Se mantienen las credenciales,
los metodos GET/POST/PUT/PATCH/DELETE/OPTIONS y los encabezados
Content-Type/Authorization. Otros origenes no reciben autorizacion CORS.

La configuracion esta en `src/config/cors.js`; reiniciar o redesplegar el
servidor para aplicar cambios. Prueba local sin servicios externos:

```powershell
node --test .\src\config\cors.test.js
```

## Acceso a Ticketera

`src/middlewares/ticketera-access.js` resuelve acceso a partir de las
`herramientas` y el `rango` del JWT verificado, emitido con datos de
`obtener_datos_usuario_nomina`. No consulta `obtener_herramientas_usuario` para
autorizar ni confia en mail, rango, segmentos o herramientas del body, query
o sessionStorage. No hay excepcion de acceso por rango: incluso Desarrollo
requiere las herramientas en su JWT.

| Perfil | Crear/buscar/detalle | Listar / metricas / exportar | Editar estados/comentarios | Crear/borrar alertas | Vista previa |
|---|---|---|---|---|---|
| Agente 0 | Si | No | No | No | No |
| Desarrollo 1 | Si | Si | Si | Si | Si |
| Lider 2, Jefatura 3, Gerencia 4 | Si | Si | No | Si | No |
| BO 5 | Si | Si | Si | Si | No |

Todas las acciones de la tabla exigen la herramienta de la ticketera concreta.
Otros rangos y perfiles invalidos se rechazan.
Mapeo: 10 ONBOARDING, 11 VENTAS, 12 ABONO/DEGRA; se comprueban ID y nombre
canonicos `TICKETERA_ONBOARDING`, `TICKETERA_VENTAS`, `TICKETERA_ABONO_DEGRA`.
El nombre ignora mayusculas y espacios exteriores.
`GET /api/ticketera/acceso` devuelve las herramientas efectivas de la sesion.
`GET /api/ticketera/permisos` devuelve `{ herramientas, permisos, perfil }`;
el frontend usa sus capacidades para mostrar controles. `perfil` contiene
email, rango, rol, usuario y segmentos del JWT. Sin asignacion, herramientas
ausentes/malformadas o rango invalido devuelve 403; sin identidad, 401.

El alcance de segmento acordado es la ticketera (ONBOARDING/VENTAS/DEGRA),
no la subdivison HOGAR/MOVIL/WSP dentro de ella. Cada RPC de listado recibe
`p_servicio` autorizado; una respuesta de otra ticketera se rechaza antes de
firmar adjuntos. Los casos a modificar se verifican contra su ticketera real.
No se puede ampliar el alcance cambiando el servicio en el navegador.

Un agente solo puede consultar `scope=mine` (correo del JWT) o buscar texto
concreto. `All`, texto vacio, comodines SQL `%`/`_` y filtros generales solos
no habilitan el listado (403), tanto en el endpoint unificado como en los
alternativos y legacy. Las coincidencias de agentes se verifican tambien
contra valores reales: las claves del JSON serializado de la RPC (por ejemplo
`email`) y los metadatos de imagenes no cuentan como coincidencia.
La busqueda por ID permite consultar detalle/adjuntos,
sin habilitar edicion. Para los demas rangos, el listado sin busqueda y sin
fechas explicitas se limita al ultimo mes calendario movil; buscar, Mis casos
y los filtros de fechas explicitos conservan su alcance. Los contadores del
inicio siguen siendo globales dentro de ONBOARDING, tambien para agentes.

El control cubre validar-acceso de la vista, listado/creacion por ticketera,
rutas legacy `/tickets`, resumen, analitica/detalle/exportacion ONBOARDING,
lideres, alertas operativas y carga de imagenes segun la ticketera real del caso.
Las actualizaciones ONBOARDING/VENTAS comprueban tambien el tipo del caso para
impedir usar la ruta de otra ticketera. No cambia permisos de otras herramientas.

`TICKETERA_ALLOW_ANY_PROFILE` ya no concede permisos. Solo Desarrollo puede
usar la vista previa de otro perfil: modifica datos visuales, nunca identidad,
herramientas ni acciones efectivas. Consultar perfiles ajenos por las rutas
de nomina/herramientas tambien exige rango 1.

### Imagenes inmutables despues de crear

`POST /api/crearTicketera` recibe JSON `{ servicio, ticket }` sin archivos, o
multipart con `servicio`, `ticket` (JSON) e `imagenes` (hasta 3). Comprueba y
optimiza todos los archivos antes de crear el caso; los guarda en esa misma
solicitud. La ruta legacy `/tickets` tambien recibe sus archivos al crear.
`POST /api/subirImagenesTicketera` devuelve 403 para todos, incluso Desarrollo
y BO: no se pueden agregar ni modificar imagenes de casos existentes.
Las rutas antiguas de creacion JSON siguen disponibles, sin carga posterior.

Si falla Storage o la persistencia de metadatos despues de crear el caso,
se limpian los adjuntos de esa solicitud y se devuelve 500 con `ticketCreado`,
`caso_id` e `id_tck`. El caso puede persistir sin adjuntos; no se garantiza una
transaccion atomica entre SQL y Storage. El frontend muestra el error y bloquea
el reenvio del formulario para evitar duplicados, sin ofrecer carga posterior.

### Despliegue

1. Verificar asignaciones de nomina -> segmentos_nomina ->
   herramientas_segmentos y las herramientas 10/11/12.
2. Aplicar en Supabase las migraciones previas de analitica/exportacion faltantes
   y luego `20261028000000_scope_onboarding_analytics.sql` del repo frontend.
   Preparar respaldo y revisar consumidores de la vista antes de aplicarla:
   la vista compartida pasa a devolver solo ONBOARDING.
3. Desplegar backend y luego frontend. No se aplican migraciones automaticamente
   al iniciar Express. Sin la nueva migracion, analitica devuelve error y no
   recurre a las RPC antiguas que mezclan ticketeras.
4. Verificar cuentas sin asignacion, con una o varias, y la matriz por rango.
   Emitir nuevos JWT con herramientas; los anteriores sin asignaciones no
   obtienen acceso. Este cambio no requiere nuevas migraciones.

La ruta historica `/tickets/statistics` ya no ejecuta su RPC global sin alcance:
devuelve 410 para perfiles antes habilitados y mantiene 403 para los demas.
Usar `/tickets/analytics`, limitado a ONBOARDING, con sus rutas de detalle/exportacion.

Alcance pendiente: aislamiento de filas entre subsegmentos de una misma
ticketera y
los riesgos de grants/RPC/Storage descritos en el reporte. Estos controles
de Express no sustituyen el endurecimiento del acceso directo a Supabase.

### Pruebas locales (Supabase simulado)

```powershell
node --test .\src\utils\ticket-access.test.js .\src\routes\auth.routes.test.js .\src\middlewares\ticketera-access.test.js .\src\routes\ticketera-analytics.routes.test.js .\src\routes\alertas-operativas.routes.test.js .\src\routes\image-uploads.routes.test.js
```
