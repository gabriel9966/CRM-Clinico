-- A role usada pelas policies não é uma credencial de login e não pode ignorar RLS.
ALTER ROLE novacrm_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
