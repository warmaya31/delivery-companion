CREATE TABLE public.motoboys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  ativo BOOLEAN NOT NULL DEFAULT true,
  device_id TEXT,
  ativado_em TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.motoboys TO authenticated;
GRANT ALL ON public.motoboys TO service_role;

ALTER TABLE public.motoboys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "motoboys_admin_all" ON public.motoboys FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER motoboys_updated_at BEFORE UPDATE ON public.motoboys
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.corridas ADD COLUMN motoboy_ref UUID REFERENCES public.motoboys(id) ON DELETE SET NULL;
ALTER TABLE public.posicoes ADD COLUMN motoboy_ref UUID REFERENCES public.motoboys(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.ativar_convite(_token TEXT, _device_id TEXT)
RETURNS TABLE (id UUID, nome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.motoboys m
     SET device_id = _device_id,
         ativado_em = COALESCE(m.ativado_em, now())
   WHERE m.token = _token AND m.ativo = true;

  RETURN QUERY
  SELECT m.id, m.nome FROM public.motoboys m
  WHERE m.token = _token AND m.ativo = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ativar_convite(TEXT, TEXT) TO anon, authenticated;