import type { CustomFieldDefinitionDTO } from "@/lib/types";

// Renderiza os campos personalizados de uma entidade (Contato ou
// Oportunidade) dentro de um <form>. Cada input usa name={`cf_${key}`} —
// o form que o chama lê esses valores do FormData e monta o objeto
// customFields antes de salvar (ver readCustomFieldValues).
export function CustomFieldInputs({
  definitions,
  entity,
  values,
}: {
  definitions: CustomFieldDefinitionDTO[];
  entity: "CONTACT" | "OPPORTUNITY";
  values: Record<string, unknown>;
}) {
  const fields = definitions.filter((d) => d.entity === entity);
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((f) => {
        const current = values[f.key];
        const name = `cf_${f.key}`;
        if (f.type === "BOOLEAN") {
          return (
            <div className="field" key={f.id}>
              <label>{f.label}</label>
              <select name={name} defaultValue={current === true ? "true" : current === false ? "false" : ""}>
                <option value="">—</option>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </div>
          );
        }
        if (f.type === "SELECT") {
          return (
            <div className="field" key={f.id}>
              <label>{f.label}</label>
              <select name={name} defaultValue={typeof current === "string" ? current : ""}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <div className="field" key={f.id}>
            <label>{f.label}</label>
            <input
              name={name}
              type={f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : "text"}
              step={f.type === "NUMBER" ? "any" : undefined}
              defaultValue={current === undefined || current === null ? "" : String(current)}
            />
          </div>
        );
      })}
    </>
  );
}

export function readCustomFieldValues(
  fd: FormData,
  definitions: CustomFieldDefinitionDTO[],
  entity: "CONTACT" | "OPPORTUNITY"
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of definitions.filter((d) => d.entity === entity)) {
    const raw = fd.get(`cf_${f.key}`);
    if (raw === null || raw === "") continue;
    if (f.type === "NUMBER") values[f.key] = Number(raw);
    else if (f.type === "BOOLEAN") values[f.key] = raw === "true";
    else values[f.key] = String(raw);
  }
  return values;
}
