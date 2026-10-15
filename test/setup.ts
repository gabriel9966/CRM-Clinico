// Garante variáveis de ambiente mínimas pra qualquer teste que toque módulos
// que leem process.env no import (crypto.ts, etc.) mesmo fora do vitest.config env.
process.env.CONNECTIONS_SECRET ||= "test-connections-secret-not-for-production-use";
process.env.SESSION_SECRET ||= "test-session-secret-not-for-production-use-long-enough";
