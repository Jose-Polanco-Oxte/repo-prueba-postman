# Users API Demo

API pequeña para practicar pruebas manuales y automatizadas con Postman/Newman. Incluye CRUD de usuarios, JWT, Basic Auth, OAuth 2.0 y OpenAPI generado desde los esquemas de las rutas.

**No incluye colecciones de Postman ni pipelines CI/CD.** Las pruebas del repositorio usan el ejecutor nativo de Node.js y sirven para comprobar el ejemplo antes de la presentación.

## Arranque rápido

Necesitas Node.js 22 o posterior y npm. Desde esta carpeta:

```sh
npm install
npm start
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/docs/
- OpenAPI en vivo: http://localhost:3000/openapi.json
- Archivo para importar: [docs/openapi.json](docs/openapi.json)

No requiere base de datos ni servicios externos. Los datos y los tokens OAuth viven en memoria: reiniciar el proceso restaura el usuario inicial y borra los usuarios registrados. Los JWT de una ejecución anterior no tienen garantía de revocación si conservas el secreto y el usuario existe. Cada instancia tiene su propio estado.

Opcionalmente copia `.env.example` a `.env` para cambiar host, puerto, secreto JWT o credenciales OAuth. `npm start` carga ese archivo automáticamente; `npm run dev` reinicia al editar código. El servidor escucha en `127.0.0.1` por defecto.

## Ejecutar con Docker

Necesitas Docker con Docker Compose. Desde esta carpeta:

```sh
docker compose up --build -d
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/docs/
- Estado del contenedor: `docker compose ps` (incluye el chequeo de `/health`).
- Logs: `docker compose logs -f api`.
- Detener y eliminar el contenedor: `docker compose down`.

Compose funciona sin crear un archivo `.env`. Si existe, usa `PORT` para el puerto de tu equipo y `JWT_SECRET`, `OAUTH_CLIENT_ID` y `OAUTH_CLIENT_SECRET` para la autenticación. Por ejemplo, con `PORT=3001` la API queda en http://localhost:3001; ajusta también `baseUrl` o `servers` al importar OpenAPI. Dentro del contenedor el servidor siempre escucha en `0.0.0.0:3000`; el valor local de `HOST` no lo modifica. El puerto se publica en `127.0.0.1` de tu equipo.

La imagen instala las dependencias de producción con `npm ci` y el lockfile, ejecuta Node directamente como usuario sin privilegios y comprueba `/health`. El contexto de construcción solo incluye los manifiestos npm y `src/`, por lo que `.env` y las dependencias locales quedan fuera de la imagen. No se necesitan volúmenes: los datos siguen en memoria y se pierden al reiniciar el contenedor.

También puedes ejecutar la imagen sin Compose:

```sh
docker build -t users-api-demo .
docker run --rm --name users-api-demo -p 127.0.0.1:3000:3000 users-api-demo
```

En ese caso, pasa la configuración con `-e JWT_SECRET=...` u otras variables `-e`. Si usas `--env-file .env`, agrega `-e HOST=0.0.0.0 -e PORT=3000` para mantener la escucha interna del contenedor.

## Credenciales de demostración

| Uso | Identificador | Contraseña / secreto |
| --- | --- | --- |
| Usuario para Basic y login JWT | `demo@example.com` | `Demo12345!` |
| Cliente OAuth 2.0 | `postman-demo` | `demo-client-secret` |

El ID del usuario inicial es `00000000-0000-4000-8000-000000000001`. Las contraseñas se guardan con salt y scrypt y no aparecen en las respuestas.

Este es un laboratorio local con credenciales públicas. Para mantener la demostración sencilla, **cualquier usuario autenticado puede consultar, modificar y eliminar a todos los usuarios**. No hay roles ni separación por propietario. OAuth limita estas acciones con scopes. No es una plantilla lista para producción: no incorpora HTTPS, rate limiting, recuperación de contraseña, refresh tokens ni un proveedor externo de identidad. Usa datos ficticios.

## Contrato HTTP

Todos los cuerpos son JSON salvo `/oauth/token`, que usa `application/x-www-form-urlencoded`.

| Método | Ruta | Autenticación | Resultado |
| --- | --- | --- | --- |
| GET | `/health` | Pública | `200`, estado del servicio |
| POST | `/users` | Pública | `201`, registrar usuario |
| GET | `/users` | Basic, JWT u OAuth `users:read` | `200`, arreglo de usuarios |
| GET | `/users/{id}` | Basic, JWT u OAuth `users:read` | `200`, usuario |
| PATCH | `/users/{id}` | Basic, JWT u OAuth `users:write` | `200`, actualización parcial |
| DELETE | `/users/{id}` | Basic, JWT u OAuth `users:write` | `204`, sin cuerpo |
| POST | `/auth/login` | Pública, credenciales en JSON | `200`, JWT por 15 minutos |
| POST | `/oauth/token` | Basic con credenciales del **cliente** | `200`, token OAuth por una hora |

Registro requiere `name`, `email` y `password` (8 a 128 caracteres). PATCH acepta uno o varios de esos campos. El email se normaliza a minúsculas y debe ser único. El nombre no puede estar vacío ni contener solo espacios. Se rechazan campos adicionales. Los IDs son UUID. Los usuarios incluyen `id`, `name`, `email`, `createdAt` y `updatedAt`. No hay paginación para mantener el ejemplo pequeño.

Errores comunes:

| Código | Caso |
| --- | --- |
| 400 | JSON, campos o UUID inválidos; PATCH vacío; grant o scope inválido |
| 401 | Credenciales ausentes/incorrectas o token inválido/vencido |
| 403 | Token OAuth válido sin el scope requerido |
| 404 | Usuario inexistente |
| 409 | Email ya registrado |
| 415 | Content-Type no soportado |

Los errores de la API usan `{ "error": "codigo", "message": "descripcion" }`. La validación del cuerpo y de los parámetros ocurre antes de la autenticación; una petición mal formada puede devolver `400` aunque no incluya credenciales.

## Probar los tres métodos de autenticación

Puedes usar directamente Swagger UI con **Authorize**, o configurar las solicitudes en Postman. Los métodos se aceptan como alternativas en las rutas protegidas; cada petición usa un único encabezado `Authorization`.

### Basic Auth

En Postman selecciona **Authorization → Basic Auth**, con el email y contraseña del usuario. Envía `GET /users`.

```http
GET /users
Authorization: Basic ZGVtb0BleGFtcGxlLmNvbTpEZW1vMTIzNDUh
```

Ese valor es `Base64("demo@example.com:Demo12345!")`: se unen el email (usuario) y la contraseña con dos puntos y se codifica la cadena completa. Basic Auth se envía directamente en cada petición protegida; no requiere obtener un token desde `/auth/login`. En Postman, la opción Basic Auth genera este encabezado automáticamente. También puedes agregarlo manualmente en Headers.

Para generar el valor de otras credenciales en PowerShell:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('demo@example.com:Demo12345!'))
```

Base64 es una codificación reversible, no cifrado.

### JWT

Envía `POST /auth/login` con Body → raw → JSON:

```json
{ "email": "demo@example.com", "password": "Demo12345!" }
```

Copia `access_token` de la respuesta. En las solicitudes protegidas selecciona **Bearer Token** y pega su valor. Para automatizarlo puedes guardar el valor en una variable desde el script posterior al login:

```js
pm.test("Login correcto", () => pm.response.to.have.status(200));
pm.environment.set("jwtToken", pm.response.json().access_token);
```

Usa `{{jwtToken}}` en el campo Token. Borrar el usuario invalida sus peticiones JWT; cambiar la contraseña afecta a Basic y a futuros logins, pero los JWT ya emitidos siguen vigentes hasta vencer.

### OAuth 2.0: Client Credentials

El servidor actúa como emisor OAuth local para demostrar autenticación de una aplicación, sin login interactivo ni autorización de usuarios finales. El token OAuth es opaco; JWT es un formato de token y OAuth es un protocolo, por eso se muestran separados.

En Postman selecciona **OAuth 2.0 → Get New Access Token** y configura:

| Campo | Valor |
| --- | --- |
| Grant Type | Client Credentials |
| Access Token URL | `http://localhost:3000/oauth/token` |
| Client ID | `postman-demo` |
| Client Secret | `demo-client-secret` |
| Scope | `users:read users:write` |
| Client Authentication | Send as Basic Auth header |

También puedes pedirlo manualmente con `POST /oauth/token`, Basic Auth del cliente y Body → **x-www-form-urlencoded**:

```text
grant_type=client_credentials
scope=users:read users:write
```

Usa el `access_token` como Bearer en las rutas protegidas. Si omites scope, se conceden ambos permisos; `users:read` permite consultar y `users:write` modificar/eliminar. Prueba con solo `users:read` para observar `403` al intentar borrar. Las credenciales del cliente OAuth no sirven como Basic Auth del CRUD.

## Guion para la presentación

1. Inicia la API y verifica `GET /health`.
2. Registra un usuario con `POST /users` y un email nuevo. Comprueba `201`, encabezado `Location` y ausencia de contraseña.
3. Repite el registro para mostrar `409`; omite un campo para mostrar `400`.
4. Ejecuta `GET /users` sin credenciales (`401`) y después con Basic (`200`).
5. Obtén un JWT y úsalo para consultar y actualizar el usuario creado.
6. Obtén un token OAuth con solo `users:read`: consulta (`200`) e intenta eliminar (`403`).
7. Obtén OAuth con `users:write`, elimina el usuario (`204`) y consúltalo con el usuario demo (`404`).
8. Reinicia el servidor para restablecer los datos iniciales.

Para automatizar después, importa `docs/openapi.json` en Postman y crea allí tu colección. Guarda `baseUrl`, `userId` y los tokens como variables. Genera emails únicos, por ejemplo `demo-{{$guid}}@example.com`, para que repetir una ejecución no produzca conflictos accidentales. Newman ejecuta una colección exportada desde Postman; no ejecuta el documento OpenAPI directamente. Este repositorio no genera ni entrega esa colección.

Ejemplo de aserciones que puedes añadir a una petición de registro:

```js
pm.test("Usuario creado", () => pm.response.to.have.status(201));
const user = pm.response.json();
pm.test("La contraseña no se expone", () => {
  pm.expect(user).not.to.have.property("password");
  pm.expect(user).not.to.have.property("passwordHash");
});
pm.environment.set("userId", user.id);
```

## Verificar y regenerar OpenAPI

```sh
npm test
npm run openapi
```

Las pruebas verifican CRUD, validaciones, duplicados, autenticación Basic/JWT/OAuth, scopes, tokens JWT vencidos o alterados y disponibilidad de Swagger/OpenAPI. Cada prueba crea su propia aplicación y usa peticiones HTTP inyectadas, sin abrir puertos ni necesitar el servidor iniciado.

El contrato se genera desde los esquemas de `src/schemas.js` y las rutas de `src/app.js`. Al cambiar rutas ejecuta `npm run openapi` y conserva `docs/openapi.json` actualizado. Si cambias el puerto, ajusta `servers` en el documento importado o tu variable `baseUrl`.

## Archivos principales

```text
src/app.js                   API, autenticación y almacenamiento en memoria
src/schemas.js               Validación y esquemas de respuesta
src/server.js                Inicio del servidor
scripts/generate-openapi.js  Exportación del contrato
docs/openapi.json            OpenAPI generado
test/api.test.js             Pruebas locales
```
