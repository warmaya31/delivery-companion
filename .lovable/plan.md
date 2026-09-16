# App de KM para Motoboys (funciona offline)

## O que vai ser construído

Um app de página única, feito para celular, que o motoboy usa durante o dia sem precisar de internet. Tudo fica salvo no próprio aparelho.

### Tela principal (Corrida)
- Botão grande **Iniciar corrida** / **Finalizar corrida**.
- Enquanto a corrida roda: KM percorridos ao vivo, tempo, velocidade média e ponto atual.
- Os KM são calculados pelo GPS do aparelho (rastreamento contínuo), sem depender de mapa online.
- Campo opcional de identificação da entrega (nº do pedido / cliente) preenchido antes de iniciar.
- Se o app fechar ou a tela travar, a corrida em andamento é recuperada ao abrir de novo.

### Base fixa da operação (automática)
- Tela de **Configurações** onde se cadastra o endereço/ponto fixo da operação (loja, restaurante, base).
- Pode ser salvo com um toque em **"Usar minha posição atual como base"** — sem precisar escolher no mapa nem buscar endereço.
- Com a base salva, cada corrida ganha automaticamente:
  - distância da base até o ponto de entrega (linha direta),
  - detecção automática de saída e retorno à base (raio configurável, ex. 150 m), marcando o trecho de ida e volta sem o motoboy apertar nada extra.

### Histórico
- Lista de corridas do dia e dos dias anteriores: identificação, KM, duração, horário de início/fim.
- Totais por dia e por período, com opção de exportar em CSV para pagamento/acerto.

### Preparado para login e painel administrativo (depois)
- Cada corrida é gravada com um identificador do aparelho/motoboy e um campo de "pendente de envio".
- Fica pronto um ponto único de sincronização: quando o login e o painel forem ativados, as corridas salvas offline sobem automaticamente e o administrador passa a ver a localização e os KM de cada motoboy.
- Nesta etapa nada é enviado para servidor nenhum — zero custo de backend.

## Detalhes técnicos

- Rota única `/` com abas internas (Corrida, Histórico, Configurações) — sem backend, sem banco, sem chamadas pagas.
- Geolocalização via `navigator.geolocation.watchPosition` com `enableHighAccuracy`, filtro de precisão (descarta pontos com accuracy > 30 m) e filtro de deslocamento mínimo (ignora ruído < 8 m) para o KM não inflar parado.
- Distância entre pontos por fórmula de Haversine; nenhuma API de rotas/mapas é chamada.
- Persistência em `localStorage`: corrida em andamento (`activeTrip`), histórico (`trips`), config da base (`baseLocation`) e `deviceId` gerado uma vez.
- Camada `src/lib/trips.ts` com tipos e funções de leitura/escrita, e `src/lib/sync.ts` como stub único (`syncPendingTrips`) para o futuro backend — troca só esse arquivo quando o login entrar.
- Todo acesso ao GPS e ao `localStorage` dentro de `useEffect`/handlers (nunca no render), para não quebrar a renderização no servidor.
- Design system em `src/styles.css`: tema escuro de alto contraste, tokens semânticos, botões grandes para uso com luva/sol.

## Fora do escopo desta etapa
- Login, painel administrativo e rastreamento em tempo real pelo administrador (a estrutura fica pronta; a ativação exige o backend e será um passo seguinte).
- Roteamento por ruas com mapa (usaria API paga; usamos distância direta).
