import Fastify from "fastify";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import formbody from "@fastify/formbody";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  object,
  userFields,
  userInput,
  userOutput,
  errors,
  idParams,
  tokenOutput,
  security,
} from "./schemas.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO_ID = "00000000-0000-4000-8000-000000000001";
const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
const checkPassword = (password, stored) => {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(hash, "hex"),
  );
};
const equal = (a, b) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const publicUser = ({ passwordHash, ...user }) => user;
const basicCredentials = (header) => {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header ?? "");
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : [decoded.slice(0, colon), decoded.slice(colon + 1)];
};

export async function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16384,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        keywords: ["example"],
      },
    },
  });
  const users = new Map();
  const oauthTokens = new Map();
  const now = new Date().toISOString();
  users.set(DEMO_ID, {
    id: DEMO_ID,
    name: "Usuario Demo",
    email: "demo@example.com",
    passwordHash: hashPassword("Demo12345!"),
    createdAt: now,
    updatedAt: now,
  });
  const clientId =
    options.clientId ?? process.env.OAUTH_CLIENT_ID ?? "postman-demo";
  const clientSecret =
    options.clientSecret ??
    process.env.OAUTH_CLIENT_SECRET ??
    "demo-client-secret";
  await app.register(jwt, {
    secret:
      options.jwtSecret ??
      process.env.JWT_SECRET ??
      "demo-only-change-this-secret-at-least-32-characters",
    sign: { expiresIn: "15m", iss: "users-api-demo", aud: "users-api" },
    verify: { allowedIss: "users-api-demo", allowedAud: "users-api" },
  });
  await app.register(formbody);
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Users API Demo",
        version: "1.0.0",
        description:
          "CRUD educativo. Datos en memoria; POST /users es publico. Cualquier usuario autenticado puede administrar todos los usuarios.",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Servidor local (ajustar si cambias el puerto)",
        },
      ],
      components: {
        securitySchemes: {
          basicAuth: { type: "http", scheme: "basic" },
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          oauth2: {
            type: "oauth2",
            flows: {
              clientCredentials: {
                tokenUrl: "/oauth/token",
                scopes: {
                  "users:read": "Leer usuarios",
                  "users:write": "Modificar usuarios",
                },
              },
            },
          },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  const fail = (reply, status, error, message) =>
    reply.code(status).send({ error, message });
  app.setErrorHandler((error, request, reply) => {
    if (error.validation)
      return fail(reply, 400, "validation_error", error.message);
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    return fail(
      reply,
      status,
      status >= 500 ? "internal_error" : "bad_request",
      status >= 500 ? "Error interno" : error.message,
    );
  });
  const findByEmail = (email) =>
    [...users.values()].find((user) => user.email === email.toLowerCase());
  const authenticate = (scope) => async (request, reply) => {
    const header = request.headers.authorization ?? "";
    const credentials = basicCredentials(header);
    if (credentials) {
      const user = findByEmail(credentials[0]);
      if (user && checkPassword(credentials[1], user.passwordHash)) return;
    } else if (/^Bearer /i.test(header)) {
      const token = header.slice(7);
      const oauth = oauthTokens.get(token);
      if (oauth) {
        if (oauth.expiresAt <= Date.now()) oauthTokens.delete(token);
        else if (!oauth.scopes.includes(scope)) {
          reply.header(
            "WWW-Authenticate",
            `Bearer error="insufficient_scope", scope="${scope}"`,
          );
          return fail(reply, 403, "insufficient_scope", `Se requiere ${scope}`);
        } else return;
      } else {
        try {
          await request.jwtVerify();
          if (request.user.kind === "user" && users.has(request.user.sub))
            return;
        } catch {
          /* Token invalido o vencido. */
        }
      }
    }
    reply.header("WWW-Authenticate", 'Basic realm="users-api", Bearer');
    return fail(
      reply,
      401,
      "unauthorized",
      "Credenciales invalidas o ausentes",
    );
  };
  const protectedSchema = (summary, scope, response, extra = {}) => ({
    tags: ["Users"],
    summary,
    security: security(scope),
    response: { ...response, ...errors(400, 401, 403) },
    ...extra,
  });

  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Estado del servicio",
        security: [],
        response: {
          200: object({ status: { type: "string", enum: ["ok"] } }, ["status"]),
        },
      },
    },
    async () => {
      await sleep(500);
      return { status: "ok" };
    },
  );

  app.post(
    "/auth/login",
    {
      schema: {
        tags: ["Auth"],
        summary: "Obtener un JWT con email y password",
        security: [],
        body: object(
          { email: userFields.email, password: userFields.password },
          ["email", "password"],
        ),
        response: { 200: tokenOutput, ...errors(400, 401) },
      },
    },
    async (request, reply) => {
      const user = findByEmail(request.body.email);
      if (!user || !checkPassword(request.body.password, user.passwordHash))
        return fail(reply, 401, "unauthorized", "Email o password incorrectos");
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
      return {
        access_token: app.jwt.sign({ sub: user.id, kind: "user" }),
        token_type: "Bearer",
        expires_in: 900,
      };
    },
  );

  app.post(
    "/oauth/token",
    {
      schema: {
        tags: ["Auth"],
        summary: "OAuth 2.0 Client Credentials (formulario URL encoded)",
        description:
          "Enviar application/x-www-form-urlencoded. Autenticar el cliente por Basic Auth. Si se omite scope se conceden users:read y users:write.",
        consumes: ["application/x-www-form-urlencoded"],
        security: [{ basicAuth: [] }],
        body: object(
          { grant_type: { type: "string" }, scope: { type: "string" } },
          ["grant_type"],
        ),
        response: { 200: tokenOutput, ...errors(400, 401, 415) },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
      if (
        request.headers["content-type"]?.split(";")[0].trim() !==
        "application/x-www-form-urlencoded"
      )
        return fail(
          reply,
          415,
          "invalid_request",
          "Usa application/x-www-form-urlencoded",
        );
      const credentials = basicCredentials(request.headers.authorization);
      if (
        !credentials ||
        !equal(credentials[0], clientId) ||
        !equal(credentials[1], clientSecret)
      ) {
        reply.header("WWW-Authenticate", 'Basic realm="oauth-client"');
        return fail(
          reply,
          401,
          "invalid_client",
          "Credenciales de cliente incorrectas",
        );
      }
      if (request.body.grant_type !== "client_credentials")
        return fail(
          reply,
          400,
          "unsupported_grant_type",
          "Usa client_credentials",
        );
      const scopes = [
        ...new Set(
          (request.body.scope ?? "users:read users:write")
            .split(/\s+/)
            .filter(Boolean),
        ),
      ];
      if (
        !scopes.length ||
        scopes.some((scope) => !["users:read", "users:write"].includes(scope))
      )
        return fail(
          reply,
          400,
          "invalid_scope",
          "Scopes validos: users:read users:write",
        );
      for (const [token, value] of oauthTokens)
        if (value.expiresAt <= Date.now()) oauthTokens.delete(token);
      const accessToken = randomBytes(32).toString("hex");
      oauthTokens.set(accessToken, { scopes, expiresAt: Date.now() + 3600000 });
      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        scope: scopes.join(" "),
      };
    },
  );

  app.post(
    "/users",
    {
      schema: {
        tags: ["Users"],
        summary: "Registrar usuario (publico)",
        security: [],
        body: userInput,
        response: { 201: userOutput, ...errors(400, 409) },
      },
    },
    async (request, reply) => {
      const { name, email, password } = request.body;
      if (findByEmail(email))
        return fail(reply, 409, "email_exists", "El email ya esta registrado");
      const timestamp = new Date().toISOString();
      const user = {
        id: randomUUID(),
        name: name.trim(),
        email: email.toLowerCase(),
        passwordHash: hashPassword(password),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      users.set(user.id, user);
      return reply
        .code(201)
        .header("Location", `/users/${user.id}`)
        .send(publicUser(user));
    },
  );
  app.get(
    "/users",
    {
      preHandler: authenticate("users:read"),
      schema: protectedSchema("Listar usuarios", "users:read", {
        200: { type: "array", items: userOutput },
      }),
    },
    async () => [...users.values()].map(publicUser),
  );
  app.get(
    "/users/:id",
    {
      preHandler: authenticate("users:read"),
      schema: protectedSchema(
        "Consultar usuario",
        "users:read",
        { 200: userOutput, ...errors(404) },
        { params: idParams },
      ),
    },
    async (request, reply) => {
      const user = users.get(request.params.id);
      return user
        ? publicUser(user)
        : fail(reply, 404, "not_found", "Usuario no encontrado");
    },
  );
  app.patch(
    "/users/:id",
    {
      preHandler: authenticate("users:write"),
      schema: protectedSchema(
        "Actualizar parcialmente un usuario",
        "users:write",
        { 200: userOutput, ...errors(404, 409) },
        {
          params: idParams,
          body: { ...object(userFields), minProperties: 1 },
        },
      ),
    },
    async (request, reply) => {
      const user = users.get(request.params.id);
      if (!user) return fail(reply, 404, "not_found", "Usuario no encontrado");
      const { name, email, password } = request.body;
      const duplicate = email && findByEmail(email);
      if (duplicate && duplicate.id !== user.id)
        return fail(reply, 409, "email_exists", "El email ya esta registrado");
      if (name !== undefined) user.name = name.trim();
      if (email !== undefined) user.email = email.toLowerCase();
      if (password !== undefined) user.passwordHash = hashPassword(password);
      user.updatedAt = new Date().toISOString();
      return publicUser(user);
    },
  );
  app.delete(
    "/users/:id",
    {
      preHandler: authenticate("users:write"),
      schema: protectedSchema(
        "Eliminar usuario",
        "users:write",
        {
          204: { type: "null", description: "Usuario eliminado; sin cuerpo" },
          ...errors(404),
        },
        { params: idParams },
      ),
    },
    async (request, reply) => {
      if (!users.delete(request.params.id))
        return fail(reply, 404, "not_found", "Usuario no encontrado");
      return reply.code(204).send();
    },
  );
  app.get("/openapi.json", { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  await app.ready();
  return app;
}
