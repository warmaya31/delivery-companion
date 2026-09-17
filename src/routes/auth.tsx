import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar no painel — KM Motoboy" },
      {
        name: "description",
        content:
          "Acesso do administrador para ver a localização dos motoboys, as empresas cadastradas e as entregas confirmadas.",
      },
      { property: "og:title", content: "Entrar no painel — KM Motoboy" },
      {
        property: "og:description",
        content: "Área do administrador do KM Motoboy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/admin", replace: true });
    });
  }, [navigate]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    setMsg(null);
    try {
      if (modo === "criar") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/admin", replace: true });
        else setMsg("Conta criada. Confirme o e-mail que enviamos para poder entrar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: senha,
        });
        if (error) throw error;
        navigate({ to: "/admin", replace: true });
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setCarregando(false);
    }
  };

  const entrarComGoogle = async () => {
    setMsg(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setMsg("Não foi possível entrar com o Google.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/admin", replace: true });
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Painel do administrador</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre para acompanhar os motoboys, as empresas e as entregas.
          </p>
        </div>

        <form onSubmit={enviar} className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">E-mail</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Senha</span>
            <input
              type="password"
              required
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-3 text-base outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-xl bg-primary px-4 py-4 text-base font-bold text-primary-foreground disabled:opacity-60"
          >
            {modo === "criar" ? "Criar conta de administrador" : "Entrar"}
          </button>
        </form>

        <button
          onClick={entrarComGoogle}
          className="w-full rounded-xl border border-input bg-card px-4 py-3 text-sm font-semibold"
        >
          Continuar com Google
        </button>

        <button
          onClick={() => setModo(modo === "entrar" ? "criar" : "entrar")}
          className="w-full text-center text-sm text-muted-foreground underline"
        >
          {modo === "entrar" ? "Não tenho conta ainda" : "Já tenho conta"}
        </button>

        {msg && (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">{msg}</p>
        )}
      </div>
    </div>
  );
}
