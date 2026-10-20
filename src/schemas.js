export const object = (properties, required = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

export const userFields = {
  name: {
    type: "string",
    minLength: 1,
    maxLength: 100,
    pattern: "\\S",
    example: "Ana Lopez",
  },
  email: {
    type: "string",
    format: "email",
    maxLength: 254,
    example: "ana@example.com",
  },
  password: {
    type: "string",
    minLength: 8,
    maxLength: 128,
    writeOnly: true,
    example: "Demo12345!",
  },
};
export const userInput = object(userFields, ["name", "email", "password"]);
export const userOutput = object(
  {
    id: { type: "string", format: "uuid" },
    name: userFields.name,
    email: userFields.email,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  ["id", "name", "email", "createdAt", "updatedAt"],
);
export const errorOutput = object(
  {
    error: { type: "string" },
    message: { type: "string" },
  },
  ["error", "message"],
);
export const errors = (...codes) =>
  Object.fromEntries(codes.map((code) => [code, errorOutput]));
export const idParams = object({ id: { type: "string", format: "uuid" } }, [
  "id",
]);
export const tokenOutput = object(
  {
    access_token: { type: "string" },
    token_type: { type: "string", enum: ["Bearer"] },
    expires_in: { type: "integer" },
    scope: { type: "string" },
  },
  ["access_token", "token_type", "expires_in"],
);
export const security = (scope) => [
  { basicAuth: [] },
  { bearerAuth: [] },
  { oauth2: [scope] },
];
