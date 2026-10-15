import "server-only";
import { csvHeader, csvLine } from "./csv";

// Exportação CSV em fluxo: busca um lote por vez (por cursor) e já envia ao
// navegador, então a memória não cresce com o tamanho da base — antes a rota
// carregava todos os registros e montava o arquivo inteiro numa string.

export type Batch = { rows: Record<string, unknown>[]; next: string | null };

export function csvDownload(
  filename: string,
  columns: string[],
  fetchBatch: (cursor: string | null) => Promise<Batch>
): Response {
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let started = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(csvHeader(columns) + "\n"));
        }
        const { rows, next } = await fetchBatch(cursor);
        if (rows.length > 0) {
          controller.enqueue(encoder.encode(rows.map((r) => csvLine(r, columns)).join("\n") + "\n"));
        }
        if (!next) {
          controller.close();
          return;
        }
        cursor = next;
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
