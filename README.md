# Server

## Alcance de alertas operativas

Las nuevas alertas se publican solo en la ticketera activa (`servicio`),
validada contra los accesos del usuario autenticado. `servicios` es opcional:
si se envia debe contener exactamente esa ticketera, incluso para administradores.
Se conserva el permiso existente de publicacion (rangos 1 y 5).

La eliminacion admite rangos 1 a 5, nunca agentes (0) ni perfiles invalidos.
Antes de ejecutar la RPC de borrado por ID, el servidor consulta las alertas
de la ticketera activa y verifica el ID y su pertenencia. Un ID ajeno o un
fallo de verificacion no ejecuta el borrado. Las alertas antiguas compartidas
requieren acceso a todos sus destinos, ya que el borrado es global.
No requiere migraciones; desplegar backend y frontend juntos.

## Optimizacion de imagenes antes de Supabase Storage

Las nuevas cargas de alertas operativas, `/subirImagenesTicketera` y `/tickets`
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

`src/middlewares/ticketera-access.js` resuelve permisos a partir del correo y
rango del JWT verificado. La RPC `obtener_herramientas_usuario` obtiene las
asignaciones de segmentos/herramientas; no se confia en mail, rango ni segmento
enviados en el body, query o sessionStorage.

| Perfil | Acceso |
|---|---|
| Desarrollo 1, Jefatura 3, Gerencia 4 | Todas las ticketeras |
| Agente 0, Lider 2, BO 5 | Solo herramientas asignadas |
| Rango 6 / perfil invalido | Denegado |

Mapeo: 10 ONBOARDING, 11 VENTAS, 12 ABONO/DEGRA; tambien se reconocen nombres
canonicos `TICKETERA_ONBOARDING`, `TICKETERA_VENTAS`, `TICKETERA_ABONO_DEGRA`.
`GET /api/ticketera/acceso` devuelve las herramientas efectivas de la sesion.
Sin asignacion devuelve 403; sin identidad 401; fallo RPC 500; formato invalido
502. No se cachean permisos entre solicitudes.

El control cubre validar-acceso de la vista, listado/creacion por ticketera,
rutas legacy `/tickets`, resumen, analitica/detalle/exportacion ONBOARDING,
lideres, alertas operativas y carga de imagenes segun la ticketera real del caso.
Las actualizaciones ONBOARDING/VENTAS comprueban tambien el tipo del caso para
impedir usar la ruta de otra ticketera. No cambia permisos de otras herramientas.

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
4. Verificar cuentas sin asignacion, con una o varias, y excepciones 1/3/4.

La RPC historica `/tickets/statistics` no admite alcance y se permite solo a
cuentas con acceso a las tres ticketeras. Para usuarios ONBOARDING se utiliza
`/tickets/analytics`, que es el informe de la interfaz actual.

Alcance pendiente: aislamiento de filas entre subsegmentos de una misma
ticketera, permisos de mutacion/inmutabilidad, flag de pruebas de estados y
los riesgos de grants/RPC/Storage descritos en el reporte. Estos controles
de Express no sustituyen el endurecimiento del acceso directo a Supabase.

### Pruebas locales (Supabase simulado)

```powershell
node --test .\src\middlewares\ticketera-access.test.js .\src\routes\ticketera-analytics.routes.test.js .\src\routes\alertas-operativas.routes.test.js
```
