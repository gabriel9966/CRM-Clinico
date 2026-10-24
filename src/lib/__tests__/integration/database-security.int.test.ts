import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

type TableSecurity = { table_name: string; rls_enabled: boolean; rls_forced: boolean; public_access: boolean; app_access: boolean };

describe.skipIf(!process.env.TEST_DATABASE_URL)("barreira de acesso do PostgreSQL", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });

  afterAll(async () => { await pool?.end(); });

  it("mantém RLS obrigatório e nenhum privilégio público em cada tabela", async () => {
    const { rows } = await pool.query<TableSecurity>(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'SELECT') AS public_access,
        has_table_privilege('novacrm_app', c.oid, 'SELECT') AS app_access
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    `);
    expect(rows.length).toBeGreaterThan(30);
    for (const table of rows) {
      expect(table.rls_enabled, table.table_name).toBe(true);
      expect(table.rls_forced, table.table_name).toBe(true);
      expect(table.public_access, table.table_name).toBe(false);
      expect(table.app_access, table.table_name).toBe(table.table_name !== "_prisma_migrations");
    }
  });

  it("nega leitura sem a role interna e permite somente à role do servidor", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE novacrm_app");
      await expect(client.query('SELECT count(*) FROM public."Contact"')).resolves.toBeDefined();
      await expect(client.query('SELECT count(*) FROM public."_prisma_migrations"')).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("mantém a role de acesso sem login e sem capacidades de bypass", async () => {
    const { rows } = await pool.query<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(`
      SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles WHERE rolname = 'novacrm_app'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false });
  });

  it("não concede acesso REST às roles Supabase quando elas existem", async () => {
    const { rows } = await pool.query<{ role_name: string; granted_tables: number }>(`
      SELECT r.rolname AS role_name,
        count(*) FILTER (WHERE has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE'))::int AS granted_tables
      FROM pg_roles r
      CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
        AND n.nspname = 'public' AND c.relkind IN ('r', 'p')
      GROUP BY r.rolname
    `);
    for (const role of rows) expect(role.granted_tables, role.role_name).toBe(0);
  });
});
