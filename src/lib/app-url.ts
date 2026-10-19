// URL pública da aplicação. Em route handlers atrás do nginx, `req.url` aponta
// para o host interno (localhost:3000), então redirecionamentos usam isto.
export function appUrl(path: string) {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return new URL(path, base + "/");
}
