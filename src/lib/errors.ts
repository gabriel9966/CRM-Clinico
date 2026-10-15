// Erro de regra de negócio com código estável e status HTTP. As rotas da API
// convertem qualquer AppError em { error: code, detail } com esse status.
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 409
  ) {
    super(message);
  }
}
