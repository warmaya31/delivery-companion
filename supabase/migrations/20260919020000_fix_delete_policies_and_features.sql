-- Permitir que administradores excluam e atualizem corridas
GRANT DELETE, UPDATE ON public.corridas TO authenticated;

DROP POLICY IF EXISTS "corridas_delete_admin" ON public.corridas;
CREATE POLICY "corridas_delete_admin" ON public.corridas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "corridas_update_admin" ON public.corridas;
CREATE POLICY "corridas_update_admin" ON public.corridas FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Permitir que administradores excluam posições de GPS antigas
GRANT DELETE ON public.posicoes TO authenticated;

DROP POLICY IF EXISTS "posicoes_delete_admin" ON public.posicoes;
CREATE POLICY "posicoes_delete_admin" ON public.posicoes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Adicionar suporte a múltiplos destinos por corrida
ALTER TABLE public.corridas ADD COLUMN IF NOT EXISTS destinos JSONB;

-- Função segura para verificar se um motoboy está com acesso ativo
CREATE OR REPLACE FUNCTION public.verificar_motoboy_ativo(_id UUID DEFAULT NULL, _token TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.motoboys
    WHERE (_id IS NOT NULL AND id = _id AND ativo = true)
       OR (_token IS NOT NULL AND token = _token AND ativo = true)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verificar_motoboy_ativo(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_motoboy_ativo(UUID, TEXT) TO anon, authenticated;
