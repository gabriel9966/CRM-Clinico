import { StatusScreen } from "@/components/shared/StatusScreen";

export default function NotFound() {
  return (
    <StatusScreen
      code="Erro 404"
      title="Página não encontrada"
      message="O endereço pode estar errado ou o conteúdo foi removido."
    />
  );
}
