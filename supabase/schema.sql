-- Diário ABC: banco de dados. Cole tudo no SQL Editor do Supabase e clique em Run.
-- Na última linha, troque CONVITE-AQUI pelo código de convite que você quer usar.
-- As tabelas ficam fechadas (RLS ligado, sem políticas); o app só fala com elas pelas funções abaixo.
-- Os registros chegam aqui já criptografados pelo celular de cada pessoa.

create table if not exists abc_contas   (u text primary key, data jsonb not null, criado timestamptz default now());
create table if not exists abc_codigos  (h text primary key, u text not null references abc_contas(u) on delete cascade, p text not null);
create table if not exists abc_diarios  (id text primary key, token_hash text not null);
create table if not exists abc_docs     (diario text not null references abc_diarios(id) on delete cascade, col text not null, id text not null,
                                         data jsonb not null, criado text, atualizado timestamptz default now(), primary key (diario, col, id));
create index if not exists abc_docs_ord on abc_docs (diario, col, criado desc);
create table if not exists abc_lembretes(endpoint text primary key, sub jsonb not null, hora text, tz text not null,
                                         ultimo_checkin text, ultimo_envio text, agenda jsonb default '[]'::jsonb, tem_compras boolean default false,
                                         enviados jsonb default '{}'::jsonb, criado timestamptz default now());
create table if not exists abc_servidor (k text primary key, v text not null);

alter table abc_contas    enable row level security;
alter table abc_codigos   enable row level security;
alter table abc_diarios   enable row level security;
alter table abc_docs      enable row level security;
alter table abc_lembretes enable row level security;
alter table abc_servidor  enable row level security;

create or replace function abc_hash(t text) returns text language sql immutable as $$ select encode(sha256(convert_to(coalesce(t,''),'UTF8')),'hex') $$;
create or replace function abc_ok(diario text, token text) returns boolean language sql security definer set search_path = public as $$
  select exists(select 1 from abc_diarios d where d.id = diario and d.token_hash = abc_hash(token)) $$;

-- proteção contra quem fica chutando códigos: depois de 8 erros em 15 minutos, o aparelho/rede fica bloqueado por 15 minutos
create table if not exists abc_tentativas(ip text not null, quando timestamptz not null default now(), ok boolean not null);
create index if not exists abc_tentativas_ip on abc_tentativas(ip, quando);
alter table abc_tentativas enable row level security;
create or replace function abc_ip() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
                  split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1), 'sem-ip') $$;
create or replace function abc_bloqueado() returns boolean language sql security definer set search_path = public as $$
  select (select count(*) from abc_tentativas t where t.ip = abc_ip() and not t.ok and t.quando > now() - interval '15 minutes') >= 8
      or (select count(*) from abc_tentativas t where not t.ok and t.quando > now() - interval '10 minutes') >= 300 $$;
create or replace function abc_anotar(ok boolean) returns void language sql security definer set search_path = public as $$
  delete from abc_tentativas where quando < now() - interval '1 day';
  insert into abc_tentativas(ip, ok) values (abc_ip(), ok) $$;

-- entrada: só devolve a conta (ainda criptografada) para quem acertou o código
create or replace function abc_entrar(h text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if abc_bloqueado() then return jsonb_build_object('erro', 'bloqueado'); end if;
  select c.u, c.p, a.data into r from abc_codigos c join abc_contas a on a.u = c.u where c.h = abc_entrar.h;
  if r.u is null then perform abc_anotar(false); perform pg_sleep(0.5); return jsonb_build_object('erro', 'nao'); end if;
  perform abc_anotar(true);
  return jsonb_build_object('u', r.u, 'p', r.p, 'conta', r.data);
end $$;
-- esqueci meu código: precisa do login e do código de recuperação
create or replace function abc_recuperar(u text, hr text) returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if abc_bloqueado() then return jsonb_build_object('erro', 'bloqueado'); end if;
  select a.data into d from abc_contas a where a.u = abc_recuperar.u and a.data->>'hRec' = hr;
  if d is null then perform abc_anotar(false); perform pg_sleep(0.5); return jsonb_build_object('erro', 'nao'); end if;
  perform abc_anotar(true);
  return jsonb_build_object('u', u, 'conta', d);
end $$;

-- convite: só cria cadastro quem tiver o código de convite. Para trocar, rode no SQL Editor:
--   select abc_definir_convite('NOVO-CODIGO');
create or replace function abc_definir_convite(convite text) returns text language sql security definer set search_path = public as $$
  insert into abc_servidor(k, v) values ('convite_hash', abc_hash(lower(trim(convite))))
  on conflict on constraint abc_servidor_pkey do update set v = excluded.v; select 'ok' $$;
revoke all on function abc_definir_convite(text) from public, anon, authenticated;

drop function if exists abc_criar_conta(text, jsonb, text, text, text);
create or replace function abc_criar_conta(convite text, u text, conta jsonb, h_dono text, h_acomp text, token_hash text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if abc_bloqueado() then return 'bloqueado'; end if;
  if not exists(select 1 from abc_servidor s where s.k = 'convite_hash' and s.v = abc_hash(lower(trim(convite)))) then
    perform abc_anotar(false); perform pg_sleep(1); return 'convite';
  end if;
  if u !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then return 'usuario_invalido'; end if;
  if exists(select 1 from abc_contas c where c.u = abc_criar_conta.u) then return 'usuario'; end if;
  if exists(select 1 from abc_codigos c where c.h = h_dono) then return 'codigo'; end if;
  if h_acomp is not null and exists(select 1 from abc_codigos c where c.h = h_acomp) then return 'codigo_acomp'; end if;
  insert into abc_diarios(id, token_hash) values (conta->>'diario', token_hash);
  insert into abc_contas(u, data) values (u, conta);
  insert into abc_codigos(h, u, p) values (h_dono, u, 'ela');
  if h_acomp is not null then insert into abc_codigos(h, u, p) values (h_acomp, u, 'parceiro'); end if;
  return 'ok';
exception when unique_violation then return 'codigo';
end $$;

-- trocar código, código de acompanhante ou remover acesso (precisa da chave do diário)
create or replace function abc_atualizar_conta(u text, token text, patch jsonb, h_novo text, p_novo text, h_velho text) returns text
language plpgsql security definer set search_path = public as $$
declare d text;
begin
  select c.data->>'diario' into d from abc_contas c where c.u = abc_atualizar_conta.u;
  if d is null or not abc_ok(d, token) then return 'negado'; end if;
  if h_novo is not null and h_novo is distinct from h_velho then
    if exists(select 1 from abc_codigos c where c.h = h_novo) then return 'codigo'; end if;
    insert into abc_codigos(h, u, p) values (h_novo, u, p_novo);
  end if;
  if h_velho is not null and h_velho is distinct from h_novo then
    delete from abc_codigos c where c.h = h_velho and c.u = abc_atualizar_conta.u;
  end if;
  update abc_contas c set data = c.data || patch where c.u = abc_atualizar_conta.u;
  return 'ok';
exception when unique_violation then return 'codigo';
end $$;

-- registros do diário (precisa da chave do diário)
create or replace function abc_ler(diario text, token text, col text, lim int) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not abc_ok(diario, token) then raise exception 'negado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'data', x.data) order by x.criado desc nulls last)
    from (select * from abc_docs dd where dd.diario = abc_ler.diario and dd.col = abc_ler.col order by dd.criado desc nulls last limit least(greatest(lim,1),2000)) x), '[]'::jsonb);
end $$;
create or replace function abc_gravar(diario text, token text, col text, id text, data jsonb) returns text language plpgsql security definer set search_path = public as $$
begin
  if not abc_ok(diario, token) then raise exception 'negado'; end if;
  if pg_column_size(data) > 200000 then raise exception 'grande'; end if;
  insert into abc_docs(diario, col, id, data, criado) values (diario, col, id, data, data->>'criadoEm')
    on conflict on constraint abc_docs_pkey do update set data = excluded.data, criado = excluded.criado, atualizado = now();
  return 'ok';
end $$;
create or replace function abc_apagar(diario text, token text, col text, id text) returns text language plpgsql security definer set search_path = public as $$
begin
  if not abc_ok(diario, token) then raise exception 'negado'; end if;
  delete from abc_docs dd where dd.diario = abc_apagar.diario and dd.col = abc_apagar.col and dd.id = abc_apagar.id;
  return 'ok';
end $$;

-- lembretes de check-in
create or replace function abc_vapid() returns text language sql security definer set search_path = public as $$
  select v from abc_servidor where k = 'vapid_publica' $$;
create or replace function abc_lembrete_salvar(endpoint text, sub jsonb, hora text, tz text) returns text language plpgsql security definer set search_path = public as $$
begin
  if (hora is not null and hora !~ '^[0-2][0-9]:[0-5][0-9]$') or length(endpoint) > 1000 or left(endpoint, 8) <> 'https://' then return 'invalido'; end if;
  insert into abc_lembretes(endpoint, sub, hora, tz) values (endpoint, sub, hora, tz)
    on conflict on constraint abc_lembretes_pkey do update set sub = excluded.sub, hora = excluded.hora, tz = excluded.tz;
  return 'ok';
end $$;
-- saídas de casa e lista de compras: o servidor só sabe os horários e se a lista tem algo (não sabe o quê)
create or replace function abc_lembrete_agenda(endpoint text, agenda jsonb, tem_compras boolean) returns text language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(agenda) <> 'array' or jsonb_array_length(agenda) > 20 then return 'invalido'; end if;
  update abc_lembretes l set agenda = abc_lembrete_agenda.agenda, tem_compras = coalesce(abc_lembrete_agenda.tem_compras, false)
    where l.endpoint = abc_lembrete_agenda.endpoint;
  if not found then return 'sem_aparelho'; end if;
  return 'ok';
end $$;
create or replace function abc_lembrete_apagar(endpoint text) returns text language sql security definer set search_path = public as $$
  delete from abc_lembretes l where l.endpoint = abc_lembrete_apagar.endpoint; select 'ok' $$;
create or replace function abc_lembrete_checkin(endpoint text, dia text) returns text language sql security definer set search_path = public as $$
  update abc_lembretes l set ultimo_checkin = dia where l.endpoint = abc_lembrete_checkin.endpoint; select 'ok' $$;

revoke all on function abc_ok(text, text), abc_bloqueado(), abc_anotar(boolean) from public, anon, authenticated;
grant execute on function abc_entrar(text), abc_recuperar(text, text), abc_criar_conta(text, text, jsonb, text, text, text),
  abc_atualizar_conta(text, text, jsonb, text, text, text), abc_ler(text, text, text, int), abc_gravar(text, text, text, text, jsonb),
  abc_apagar(text, text, text, text), abc_vapid(), abc_lembrete_salvar(text, jsonb, text, text), abc_lembrete_agenda(text, jsonb, boolean), abc_lembrete_apagar(text),
  abc_lembrete_checkin(text, text) to anon, authenticated;

-- código de convite inicial (troque o texto entre aspas antes de rodar)
select abc_definir_convite('CONVITE-AQUI');
