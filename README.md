# Server

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
