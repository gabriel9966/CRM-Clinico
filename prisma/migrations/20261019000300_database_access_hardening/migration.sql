-- O CRM usa Prisma no servidor; nenhuma tabela precisa estar disponível pela
-- Data API pública do Supabase. A role sem login recebe apenas DML, enquanto
-- as credenciais de migração continuam separadas da aplicação.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novacrm_app') THEN
    CREATE ROLE novacrm_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO novacrm_app;

DO $$
DECLARE
  relation record;
  exposed_role text;
BEGIN
  FOR relation IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', relation.relname);
    FOREACH exposed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = exposed_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', relation.relname, exposed_role);
      END IF;
    END LOOP;
    IF relation.relname <> '_prisma_migrations' THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO novacrm_app', relation.relname);
      EXECUTE format('CREATE POLICY crm_server_only ON public.%I FOR ALL TO novacrm_app USING (true) WITH CHECK (true)', relation.relname);
    END IF;
  END LOOP;

  FOR relation IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC', relation.relname);
    FOREACH exposed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = exposed_role) THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', relation.relname, exposed_role);
      END IF;
    END LOOP;
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO novacrm_app', relation.relname);
  END LOOP;

  FOREACH exposed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = exposed_role) THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', exposed_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', exposed_role);
    END IF;
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO novacrm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO novacrm_app;
