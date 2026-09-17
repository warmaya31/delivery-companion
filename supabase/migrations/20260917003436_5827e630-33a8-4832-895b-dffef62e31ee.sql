CREATE TYPE public.app_role AS ENUM ('admin', 'motoboy');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "roles_select_own" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  endereco TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  raio_m INTEGER NOT NULL DEFAULT 200,
  created_by_device TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.empresas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresas TO authenticated;
GRANT ALL ON public.empresas TO service_role;
ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "empresas_select_all" ON public.empresas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "empresas_insert_all" ON public.empresas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "empresas_update_admin" ON public.empresas FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "empresas_delete_admin" ON public.empresas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.corridas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  device_trip_id TEXT NOT NULL,
  motoboy_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  motoboy_nome TEXT,
  label TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  distance_m DOUBLE PRECISION NOT NULL DEFAULT 0,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  end_lat DOUBLE PRECISION,
  end_lng DOUBLE PRECISION,
  empresa_id UUID REFERENCES public.empresas(id) ON DELETE SET NULL,
  empresa_nome TEXT,
  entregue_em TIMESTAMPTZ,
  base_to_end_m DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, device_trip_id)
);
GRANT INSERT ON public.corridas TO anon;
GRANT SELECT, INSERT ON public.corridas TO authenticated;
GRANT ALL ON public.corridas TO service_role;
ALTER TABLE public.corridas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corridas_insert_all" ON public.corridas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "corridas_select_admin" ON public.corridas FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR motoboy_id = auth.uid());

CREATE TABLE public.posicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  motoboy_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  motoboy_nome TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  acc DOUBLE PRECISION,
  em_corrida BOOLEAN NOT NULL DEFAULT false,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX posicoes_device_time_idx ON public.posicoes (device_id, registrado_em DESC);
GRANT INSERT ON public.posicoes TO anon;
GRANT SELECT, INSERT ON public.posicoes TO authenticated;
GRANT ALL ON public.posicoes TO service_role;
ALTER TABLE public.posicoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posicoes_insert_all" ON public.posicoes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "posicoes_select_admin" ON public.posicoes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));